import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import { analysisRuns, changeLogs, projects } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { AnalysisService, type LlmInvoker } from './analysis.service.js';

function makeService(db: ShipmateDb, llm: LlmInvoker) {
  return new AnalysisService(db, llm);
}

describe('批次与素材', () => {
  it('createAnalysisRun:默认标题 + create log', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({}));
      const now = Date.now();
      const p = (await db.insert(projects).values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now }).returning())[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      expect(run).toMatchObject({ projectId: p.id, status: 'pending' });
      expect(run.title).toMatch(/^素材分析 \d{2}-\d{2} \d{2}:\d{2}$/);
      expect(await db.select().from(changeLogs).where(eq(changeLogs.entityId, run.id))).toHaveLength(1);
    });
  });

  it('addMaterial:落库 + create log;run 不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({}));
      const now = Date.now();
      const p = (await db.insert(projects).values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now }).returning())[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      const m = await svc.addMaterial({ runId: run.id, type: 'paste_text', title: '会议记录', rawContent: '要能导出 CSV' }, 'human');
      expect(m).toMatchObject({ analysisRunId: run.id, projectId: p.id, type: 'paste_text' });
      try {
        await svc.addMaterial({ runId: 'missing', type: 'doc', rawContent: 'x' }, 'human');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('listAnalysisRuns / getAnalysisRun 汇总素材与草稿计数', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({
        requirements: [{ title: 'R1', points: [{ title: 'p', confidence: 0.9, evidences: [] }] }],
        supplements: [{ target_requirement_title: '旧需求', points: [] }],
      }));
      const now = Date.now();
      const p = (await db.insert(projects).values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now }).returning())[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      await svc.addMaterial({ runId: run.id, type: 'paste_text', rawContent: '素材一' }, 'human');
      await svc.addMaterial({ runId: run.id, type: 'doc', rawContent: '素材二' }, 'human');

      expect((await svc.listAnalysisRuns(p.id))[0]).toMatchObject({ materialCount: 2, draftRequirementCount: 0 });

      await svc.startAnalysis(run.id, 'human');
      const summary = (await svc.listAnalysisRuns(p.id))[0]!;
      expect(summary).toMatchObject({ status: 'done', materialCount: 2, draftRequirementCount: 2 });

      const detail = await svc.getAnalysisRun(run.id);
      expect(detail.materials).toHaveLength(2);
      expect((detail.run.draftResult as { requirements: unknown[] }).requirements).toHaveLength(1);
    });
  });

  it('listAnalysisRuns:status 过滤', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({ requirements: [], supplements: [] }));
      const now = Date.now();
      const p = (await db.insert(projects).values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now }).returning())[0]!;
      const r1 = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      await svc.createAnalysisRun({ projectId: p.id }, 'human');
      await svc.addMaterial({ runId: r1.id, type: 'paste_text', rawContent: '素材' }, 'human');
      await svc.startAnalysis(r1.id, 'human');
      expect(await svc.listAnalysisRuns(p.id, { status: 'done' })).toHaveLength(1);
      expect(await svc.listAnalysisRuns(p.id, { status: 'pending' })).toHaveLength(1);
    });
  });
});

describe('startAnalysis', () => {
  it('空素材抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({}));
      const now = Date.now();
      const p = (await db.insert(projects).values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now }).returning())[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      try {
        await svc.startAnalysis(run.id, 'human');
        expect.unreachable('应当抛 VALIDATION_ERROR');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  it('LLM 失败 → run 置 failed 并抛 LLM_ERROR;再次分析成功可恢复为 done 并覆盖草稿', async () => {
    await withDb(async (db) => {
      const now = Date.now();
      const p = (await db.insert(projects).values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now }).returning())[0]!;
      const setup = makeService(db, async () => ({}));
      const run = await setup.createAnalysisRun({ projectId: p.id }, 'human');
      await setup.addMaterial({ runId: run.id, type: 'paste_text', rawContent: '素材' }, 'human');

      const fail = makeService(db, async () => {
        throw new DomainError('LLM_ERROR', '超时');
      });
      await expect(fail.startAnalysis(run.id, 'human')).rejects.toMatchObject({ code: 'LLM_ERROR' });
      expect((await db.select().from(analysisRuns).where(eq(analysisRuns.id, run.id)))[0]!.status).toBe('failed');

      const ok = makeService(db, async () => ({ requirements: [{ title: '新草稿', points: [] }], supplements: [] }));
      const done = await ok.startAnalysis(run.id, 'human');
      expect(done.status).toBe('done');
      expect((done.draftResult as { requirements: { title: string }[] }).requirements[0]!.title).toBe('新草稿');
    });
  });

  it('LLM 产出不合 schema → LLM_SCHEMA_MISMATCH 且 run failed', async () => {
    await withDb(async (db) => {
      const now = Date.now();
      const p = (await db.insert(projects).values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now }).returning())[0]!;
      const setup = makeService(db, async () => ({}));
      const run = await setup.createAnalysisRun({ projectId: p.id }, 'human');
      await setup.addMaterial({ runId: run.id, type: 'paste_text', rawContent: '素材' }, 'human');
      const bad = makeService(db, async () => ({ wrong: 'shape' }));
      await expect(bad.startAnalysis(run.id, 'human')).rejects.toMatchObject({ code: 'LLM_SCHEMA_MISMATCH' });
      expect((await db.select().from(analysisRuns).where(eq(analysisRuns.id, run.id)))[0]!.status).toBe('failed');
    });
  });

  it('成功路径:llm 收到的 user prompt 含素材原文;status_change log 剔除草稿正文', async () => {
    await withDb(async (db) => {
      const llm = vi.fn(async (_system: string, _user: string) => ({ requirements: [], supplements: [] }));
      const svc = makeService(db, llm);
      const now = Date.now();
      const p = (await db.insert(projects).values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now }).returning())[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      await svc.addMaterial({ runId: run.id, type: 'paste_text', rawContent: '独有素材标记XYZ' }, 'human');
      await svc.startAnalysis(run.id, 'ai:analysis');
      expect(llm).toHaveBeenCalledTimes(1);
      expect(String(llm.mock.calls[0]![1])).toContain('独有素材标记XYZ');

      const log = (await db.select().from(changeLogs).where(eq(changeLogs.entityId, run.id))).find(
        (l) => l.changeType === 'status_change',
      )!;
      expect(JSON.stringify(log.afterSnapshot)).not.toContain('requirements');
    });
  });

  it('run 不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({}));
      await expect(svc.startAnalysis('missing', 'human')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
