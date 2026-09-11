import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import { analysisRuns, changeLogs, projects, requirementPoints, requirements } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { AnalysisService, type LlmInvoker } from './analysis.service.js';
import { TaskService } from './task.service.js';

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

describe('applyAnalysisRun', () => {
  const goodDraft = {
    requirements: [
      { title: '全新需求A', summary: 'A 摘要', points: [{ title: 'A1', description: '', confidence: 0.9, evidences: [{ material_id: 'm-ghost', quote: '原文' }] }] },
      { title: '重复块B', summary: '', conflict: { type: 'duplicate', target_requirement_title: '已有需求X', reason: '同口径' }, points: [{ title: 'X1', description: '', confidence: 0.8, evidences: [{ material_id: 'm2', quote: '补充原文' }] }] },
      { title: '相悖块C', summary: '', conflict: { type: 'contradiction', target_requirement_title: '已有需求X', reason: '结论相反' }, points: [{ title: 'C1', description: '', confidence: 0.7, evidences: [] }] },
    ],
    supplements: [{ target_requirement_title: '已有需求X', points: [{ title: '补充点S', description: '', confidence: 0.85, evidences: [] }] }],
  };

  async function seedProject(db: ShipmateDb): Promise<string> {
    const now = Date.now();
    return (await db.insert(projects).values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now }).returning())[0]!.id;
  }

  async function seedDraft(db: ShipmateDb, projectId: string, draft: unknown): Promise<string> {
    const now = Date.now();
    return (
      await db
        .insert(analysisRuns)
        .values({ id: newId(), projectId, title: '批次', status: 'done', actor: 'human', draftResult: draft as never, createdAt: now, completedAt: now })
        .returning()
    )[0]!.id;
  }

  async function seedExistingX(db: ShipmateDb, projectId: string, withTask = false): Promise<string> {
    const now = Date.now();
    const req = (
      await db.insert(requirements).values({ id: newId(), projectId, title: '已有需求X', status: 'confirmed', priority: 'P1', createdAt: now, updatedAt: now }).returning()
    )[0]!;
    const point = (
      await db
        .insert(requirementPoints)
        .values({ id: newId(), requirementId: req.id, title: 'X1', status: 'confirmed', version: 1, sourceMaterialIds: ['m1'], evidences: [{ material_id: 'm1', quote: '旧原文' }], origin: 'manual', createdAt: now, updatedAt: now })
        .returning()
    )[0]!;
    if (withTask) {
      const taskSvc = new TaskService(db);
      await taskSvc.createTask({ requirementPointId: point.id, title: 'X 的任务' }, 'human');
    }
    return req.id;
  }

  it('无草稿抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const svc = makeService(db, async () => ({}));
      const empty = await svc.createAnalysisRun({ projectId }, 'human');
      try {
        await svc.applyAnalysisRun(empty.id, undefined, 'human');
        expect.unreachable('应当抛 VALIDATION_ERROR');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  it('普通块:落库 draft、溯源回填、create log', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const runId = await seedDraft(db, projectId, { requirements: [goodDraft.requirements[0]], supplements: [] });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(runId, undefined, 'human');
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ title: '全新需求A', status: 'draft', priority: 'P2' });
      const points = await db.select().from(requirementPoints).where(eq(requirementPoints.requirementId, created[0]!.id));
      expect(points[0]).toMatchObject({ status: 'draft', origin: 'analysis', sourceMaterialIds: ['m-ghost'] });
      expect(points[0]!.evidences).toEqual([{ material_id: 'm-ghost', quote: '原文' }]);
    });
  });

  it('selectedRequirements 过滤:只应用选中块', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const svc = makeService(db, async () => ({}));
      const runId = await seedDraft(db, projectId, {
        requirements: [{ title: '块一', points: [] }, { title: '块二', points: [] }],
        supplements: [],
      });
      const created = await svc.applyAnalysisRun(runId, { selectedRequirements: ['块一'] }, 'human');
      expect(created.map((r) => r.title)).toEqual(['块一']);
    });
  });

  it('duplicate 默认 merge:目标点 evidences 追加,无匹配点的草稿点作为新点追加', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, {
        requirements: [
          { title: '重复块B', summary: '', conflict: { type: 'duplicate', target_requirement_title: '已有需求X', reason: '' }, points: [
            { title: 'X1', description: '', confidence: 0.8, evidences: [{ material_id: 'm2', quote: '补充原文' }] },
            { title: '全新点Y', description: '', confidence: 0.8, evidences: [] },
          ] },
        ],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(runId, undefined, 'human');
      expect(created).toHaveLength(0); // merge 不新建需求
      const xReq = (await db.select().from(requirements)).find((r) => r.title === '已有需求X')!;
      const points = await db.select().from(requirementPoints).where(eq(requirementPoints.requirementId, xReq.id));
      const merged = points.find((p) => p.title === 'X1')!;
      expect(merged.evidences).toHaveLength(2); // 旧 + 新
      expect(merged.sourceMaterialIds).toEqual(['m1', 'm2']);
      expect(points.find((p) => p.title === '全新点Y')).toBeDefined();
    });
  });

  it('duplicate create_anyway:新建 + 双向 duplicate relations', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const xId = await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, { requirements: [goodDraft.requirements[1]!], supplements: [] });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(runId, { decisions: [{ requirementTitle: '重复块B', resolution: 'create_anyway' }] }, 'human');
      expect(created).toHaveLength(1);
      const newPoint = (await db.select().from(requirementPoints).where(eq(requirementPoints.requirementId, created[0]!.id)))[0]!;
      const oldPoints = await db.select().from(requirementPoints).where(eq(requirementPoints.requirementId, xId));
      expect(newPoint.relations).toEqual([{ type: 'duplicate', point_id: oldPoints[0]!.id }]);
      expect(oldPoints[0]!.relations).toEqual([{ type: 'duplicate', point_id: newPoint.id }]);
    });
  });

  it('contradiction 未裁决 → 整批 VALIDATION_ERROR,不落任何数据', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      await seedExistingX(db, projectId);
      const beforeCount = (await db.select().from(requirements)).length;
      const runId = await seedDraft(db, projectId, goodDraft);
      const svc = makeService(db, async () => ({}));
      try {
        await svc.applyAnalysisRun(runId, undefined, 'human');
        expect.unreachable('应当抛 VALIDATION_ERROR');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
        expect((e as DomainError).message).toContain('相悖块C');
      }
      expect((await db.select().from(requirements)).length).toBe(beforeCount);
    });
  });

  it('contradiction use_old:草稿丢弃 + discard log;use_new:旧需求任务打 needs_reassessment', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      await seedExistingX(db, projectId, true);
      const svc = makeService(db, async () => ({}));

      const run1 = await seedDraft(db, projectId, { requirements: [goodDraft.requirements[2]!], supplements: [] });
      const created1 = await svc.applyAnalysisRun(run1, { decisions: [{ requirementTitle: '相悖块C', resolution: 'use_old' }] }, 'human');
      expect(created1).toHaveLength(0);
      expect(await db.select().from(changeLogs).where(eq(changeLogs.changeType, 'discard'))).toHaveLength(1);

      const run2 = await seedDraft(db, projectId, { requirements: [goodDraft.requirements[2]!], supplements: [] });
      const created2 = await svc.applyAnalysisRun(run2, { decisions: [{ requirementTitle: '相悖块C', resolution: 'use_new' }] }, 'human');
      expect(created2).toHaveLength(1);
      const allTasks = await new TaskService(db).listTasks({});
      expect(allTasks.every((t) => t.status === 'needs_reassessment')).toBe(true);
    });
  });

  it('keep_both:双向 conflict relations', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const xId = await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, { requirements: [goodDraft.requirements[2]!], supplements: [] });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(runId, { decisions: [{ requirementTitle: '相悖块C', resolution: 'keep_both' }] }, 'human');
      expect(created).toHaveLength(1);
      const newPoint = (await db.select().from(requirementPoints).where(eq(requirementPoints.requirementId, created[0]!.id)))[0]!;
      const oldPoint = (await db.select().from(requirementPoints).where(eq(requirementPoints.requirementId, xId)))[0]!;
      expect(newPoint.relations).toEqual([{ type: 'conflict', point_id: oldPoint!.id }]);
      expect(oldPoint!.relations).toEqual([{ type: 'conflict', point_id: newPoint.id }]);
    });
  });

  it('supplement:仅追加新点(origin=supplement),已有点不动', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const xId = await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, { requirements: [], supplements: goodDraft.supplements });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(runId, undefined, 'human');
      expect(created).toHaveLength(0);
      const points = await db.select().from(requirementPoints).where(eq(requirementPoints.requirementId, xId));
      expect(points).toHaveLength(2);
      expect(points.find((p) => p.title === '补充点S')).toMatchObject({ origin: 'supplement', status: 'draft' });
      expect(points.find((p) => p.title === 'X1')).toMatchObject({ status: 'confirmed', evidences: [{ material_id: 'm1', quote: '旧原文' }] });
    });
  });

  it('resolution 与冲突类型不匹配抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, { requirements: [goodDraft.requirements[2]!], supplements: [] });
      const svc = makeService(db, async () => ({}));
      try {
        await svc.applyAnalysisRun(runId, { decisions: [{ requirementTitle: '相悖块C', resolution: 'merge' }] }, 'human');
        expect.unreachable('应当抛 VALIDATION_ERROR');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
    });
  });
});
