import { describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import {
  analysisRuns,
  changeLogs,
  projects,
  requirementPoints,
  requirements,
} from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import type { DraftPoint, DraftRequirement } from '../llm/schema.js';
import {
  AnalysisService,
  type LlmInvoker,
  type LlmStreamInvoker,
  type ReviseStreamEvent,
} from './analysis.service.js';
import { TaskService } from './task.service.js';

function makeService(db: ShipmateDb, llm: LlmInvoker, llmStream?: LlmStreamInvoker) {
  return new AnalysisService(db, llm, llmStream);
}

describe('批次与素材', () => {
  it('createAnalysisRun:默认标题 + create log', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({}));
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      expect(run).toMatchObject({ projectId: p.id, status: 'pending' });
      expect(run.title).toMatch(/^素材分析 \d{2}-\d{2} \d{2}:\d{2}$/);
      expect(
        await db.select().from(changeLogs).where(eq(changeLogs.entityId, run.id)),
      ).toHaveLength(1);
    });
  });

  it('addMaterial:落库 + create log;run 不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({}));
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      const m = await svc.addMaterial(
        { runId: run.id, type: 'paste_text', title: '会议记录', rawContent: '要能导出 CSV' },
        'human',
      );
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
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      await svc.addMaterial({ runId: run.id, type: 'paste_text', rawContent: '素材一' }, 'human');
      await svc.addMaterial({ runId: run.id, type: 'doc', rawContent: '素材二' }, 'human');

      expect((await svc.listAnalysisRuns(p.id))[0]).toMatchObject({
        materialCount: 2,
        draftRequirementCount: 0,
      });

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
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
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
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
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
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const setup = makeService(db, async () => ({}));
      const run = await setup.createAnalysisRun({ projectId: p.id }, 'human');
      await setup.addMaterial({ runId: run.id, type: 'paste_text', rawContent: '素材' }, 'human');

      const fail = makeService(db, async () => {
        throw new DomainError('LLM_ERROR', '超时');
      });
      await expect(fail.startAnalysis(run.id, 'human')).rejects.toMatchObject({
        code: 'LLM_ERROR',
      });
      expect(
        (await db.select().from(analysisRuns).where(eq(analysisRuns.id, run.id)))[0]!.status,
      ).toBe('failed');

      const ok = makeService(db, async () => ({
        requirements: [{ title: '新草稿', points: [] }],
        supplements: [],
      }));
      const done = await ok.startAnalysis(run.id, 'human');
      expect(done.status).toBe('done');
      expect(
        (done.draftResult as { requirements: { title: string }[] }).requirements[0]!.title,
      ).toBe('新草稿');
    });
  });

  it('LLM 产出不合 schema → LLM_SCHEMA_MISMATCH 且 run failed', async () => {
    await withDb(async (db) => {
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const setup = makeService(db, async () => ({}));
      const run = await setup.createAnalysisRun({ projectId: p.id }, 'human');
      await setup.addMaterial({ runId: run.id, type: 'paste_text', rawContent: '素材' }, 'human');
      const bad = makeService(db, async () => ({ wrong: 'shape' }));
      await expect(bad.startAnalysis(run.id, 'human')).rejects.toMatchObject({
        code: 'LLM_SCHEMA_MISMATCH',
      });
      expect(
        (await db.select().from(analysisRuns).where(eq(analysisRuns.id, run.id)))[0]!.status,
      ).toBe('failed');
    });
  });

  it('成功路径:llm 收到的 user prompt 含素材原文;status_change log 剔除草稿正文', async () => {
    await withDb(async (db) => {
      const llm = vi.fn(async (_system: string, _user: string) => ({
        requirements: [],
        supplements: [],
      }));
      const svc = makeService(db, llm);
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      await svc.addMaterial(
        { runId: run.id, type: 'paste_text', rawContent: '独有素材标记XYZ' },
        'human',
      );
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
      await expect(svc.startAnalysis('missing', 'human')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});

describe('applyAnalysisRun', () => {
  const goodDraft = {
    requirements: [
      {
        title: '全新需求A',
        summary: 'A 摘要',
        points: [
          {
            title: 'A1',
            description: '',
            confidence: 0.9,
            evidences: [{ material_id: 'm-ghost', quote: '原文' }],
          },
        ],
      },
      {
        title: '重复块B',
        summary: '',
        conflict: { type: 'duplicate', target_requirement_title: '已有需求X', reason: '同口径' },
        points: [
          {
            title: 'X1',
            description: '',
            confidence: 0.8,
            evidences: [{ material_id: 'm2', quote: '补充原文' }],
          },
        ],
      },
      {
        title: '相悖块C',
        summary: '',
        conflict: {
          type: 'contradiction',
          target_requirement_title: '已有需求X',
          reason: '结论相反',
        },
        points: [{ title: 'C1', description: '', confidence: 0.7, evidences: [] }],
      },
    ],
    supplements: [
      {
        target_requirement_title: '已有需求X',
        points: [{ title: '补充点S', description: '', confidence: 0.85, evidences: [] }],
      },
    ],
  };

  async function seedProject(db: ShipmateDb): Promise<string> {
    const now = Date.now();
    return (
      await db
        .insert(projects)
        .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
        .returning()
    )[0]!.id;
  }

  async function seedDraft(db: ShipmateDb, projectId: string, draft: unknown): Promise<string> {
    const now = Date.now();
    return (
      await db
        .insert(analysisRuns)
        .values({
          id: newId(),
          projectId,
          title: '批次',
          status: 'done',
          actor: 'human',
          draftResult: draft as never,
          createdAt: now,
          completedAt: now,
        })
        .returning()
    )[0]!.id;
  }

  async function seedExistingX(
    db: ShipmateDb,
    projectId: string,
    withTask = false,
  ): Promise<string> {
    const now = Date.now();
    const req = (
      await db
        .insert(requirements)
        .values({
          id: newId(),
          projectId,
          title: '已有需求X',
          status: 'confirmed',
          priority: 'P1',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    const point = (
      await db
        .insert(requirementPoints)
        .values({
          id: newId(),
          requirementId: req.id,
          title: 'X1',
          status: 'confirmed',
          version: 1,
          sourceMaterialIds: ['m1'],
          evidences: [{ material_id: 'm1', quote: '旧原文' }],
          origin: 'manual',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    if (withTask) {
      const taskSvc = new TaskService(db);
      await taskSvc.createTask({ requirementPointId: point.id, title: 'X 的任务' }, 'human');
    }
    return req.id;
  }

  /** 多点版目标需求:建「已有需求X」并按 titles 建同名点,返回需求与点 id */
  async function seedReqWithPoints(
    db: ShipmateDb,
    projectId: string,
    titles: string[],
  ): Promise<{ reqId: string; pointIds: string[] }> {
    const now = Date.now();
    const req = (
      await db
        .insert(requirements)
        .values({
          id: newId(),
          projectId,
          title: '已有需求X',
          status: 'confirmed',
          priority: 'P1',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    const pointIds: string[] = [];
    for (const t of titles) {
      const p = (
        await db
          .insert(requirementPoints)
          .values({
            id: newId(),
            requirementId: req.id,
            title: t,
            status: 'confirmed',
            version: 1,
            sourceMaterialIds: ['m1'],
            evidences: [{ material_id: 'm1', quote: '旧原文' }],
            origin: 'manual',
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!;
      pointIds.push(p!.id);
    }
    return { reqId: req.id, pointIds };
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
      const runId = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[0]],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(runId, undefined, 'human');
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ title: '全新需求A', status: 'draft', priority: 'P2' });
      const points = await db
        .select()
        .from(requirementPoints)
        .where(eq(requirementPoints.requirementId, created[0]!.id));
      expect(points[0]).toMatchObject({
        status: 'draft',
        origin: 'analysis',
        sourceMaterialIds: ['m-ghost'],
      });
      expect(points[0]!.evidences).toEqual([{ material_id: 'm-ghost', quote: '原文' }]);
    });
  });

  it('selectedRequirements 过滤:只应用选中块', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const svc = makeService(db, async () => ({}));
      const runId = await seedDraft(db, projectId, {
        requirements: [
          { title: '块一', points: [] },
          { title: '块二', points: [] },
        ],
        supplements: [],
      });
      const created = await svc.applyAnalysisRun(
        runId,
        { selectedRequirements: ['块一'] },
        'human',
      );
      expect(created.map((r) => r.title)).toEqual(['块一']);
    });
  });

  it('duplicate 默认 merge:目标点 evidences 追加,无匹配点的草稿点作为新点追加', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, {
        requirements: [
          {
            title: '重复块B',
            summary: '',
            conflict: { type: 'duplicate', target_requirement_title: '已有需求X', reason: '' },
            points: [
              {
                title: 'X1',
                description: '',
                confidence: 0.8,
                evidences: [{ material_id: 'm2', quote: '补充原文' }],
              },
              { title: '全新点Y', description: '', confidence: 0.8, evidences: [] },
            ],
          },
        ],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(runId, undefined, 'human');
      expect(created).toHaveLength(0); // merge 不新建需求
      const xReq = (await db.select().from(requirements)).find((r) => r.title === '已有需求X')!;
      const points = await db
        .select()
        .from(requirementPoints)
        .where(eq(requirementPoints.requirementId, xReq.id));
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
      const runId = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[1]!],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(
        runId,
        { decisions: [{ requirementTitle: '重复块B', resolution: 'create_anyway' }] },
        'human',
      );
      expect(created).toHaveLength(1);
      const newPoint = (
        await db
          .select()
          .from(requirementPoints)
          .where(eq(requirementPoints.requirementId, created[0]!.id))
      )[0]!;
      const oldPoints = await db
        .select()
        .from(requirementPoints)
        .where(eq(requirementPoints.requirementId, xId));
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

      const run1 = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[2]!],
        supplements: [],
      });
      const created1 = await svc.applyAnalysisRun(
        run1,
        { decisions: [{ requirementTitle: '相悖块C', resolution: 'use_old' }] },
        'human',
      );
      expect(created1).toHaveLength(0);
      // discard log 的 entityId 即 runId,按其收窄:共享真实库中可能存在其他 discard 日志
      expect(
        await db
          .select()
          .from(changeLogs)
          .where(and(eq(changeLogs.changeType, 'discard'), eq(changeLogs.entityId, run1))),
      ).toHaveLength(1);

      const run2 = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[2]!],
        supplements: [],
      });
      const created2 = await svc.applyAnalysisRun(
        run2,
        { decisions: [{ requirementTitle: '相悖块C', resolution: 'use_new' }] },
        'human',
      );
      expect(created2).toHaveLength(1);
      // 收窄到本用例自建项目:共享真实库中存在其他项目的任务
      const allTasks = await new TaskService(db).listTasks({ projectId });
      expect(allTasks.every((t) => t.status === 'needs_reassessment')).toBe(true);
    });
  });

  it('keep_both:双向 conflict relations', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const xId = await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[2]!],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(
        runId,
        { decisions: [{ requirementTitle: '相悖块C', resolution: 'keep_both' }] },
        'human',
      );
      expect(created).toHaveLength(1);
      const newPoint = (
        await db
          .select()
          .from(requirementPoints)
          .where(eq(requirementPoints.requirementId, created[0]!.id))
      )[0]!;
      const oldPoint = (
        await db.select().from(requirementPoints).where(eq(requirementPoints.requirementId, xId))
      )[0]!;
      expect(newPoint.relations).toEqual([{ type: 'conflict', point_id: oldPoint!.id }]);
      expect(oldPoint!.relations).toEqual([{ type: 'conflict', point_id: newPoint.id }]);
    });
  });

  it('conflict relations 落审计:被改写点各写 1 条 update log,快照与 updatedAt 正确', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const xId = await seedExistingX(db, projectId);
      const beforeOld = (
        await db.select().from(requirementPoints).where(eq(requirementPoints.requirementId, xId))
      )[0]!;
      const runId = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[2]!],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      // 与 seed 间隔数毫秒,确保 updatedAt 刷新可断言
      await new Promise((r) => setTimeout(r, 5));
      const created = await svc.applyAnalysisRun(
        runId,
        { decisions: [{ requirementTitle: '相悖块C', resolution: 'keep_both' }] },
        'human',
      );
      expect(created).toHaveLength(1);
      const newPoint = (
        await db
          .select()
          .from(requirementPoints)
          .where(eq(requirementPoints.requirementId, created[0]!.id))
      )[0]!;
      const oldPoint = (
        await db.select().from(requirementPoints).where(eq(requirementPoints.id, beforeOld.id))
      )[0]!;
      expect(oldPoint.updatedAt).toBeGreaterThan(beforeOld.updatedAt);

      const expectedNewRelations = [{ type: 'conflict', point_id: oldPoint.id }];
      const expectedOldRelations = [{ type: 'conflict', point_id: newPoint.id }];
      expect(newPoint.relations).toEqual(expectedNewRelations);
      expect(oldPoint.relations).toEqual(expectedOldRelations);

      for (const [pt, relations] of [
        [newPoint, expectedNewRelations],
        [oldPoint, expectedOldRelations],
      ] as const) {
        const logs = await db
          .select()
          .from(changeLogs)
          .where(
            and(
              eq(changeLogs.entityType, 'requirement_point'),
              eq(changeLogs.entityId, pt.id),
              eq(changeLogs.changeType, 'update'),
            ),
          );
        expect(logs).toHaveLength(1);
        expect(logs[0]!.actor).toBe('human');
        expect(logs[0]!.reason).toBe('冲突关系建立(重复并入/相悖裁决)');
        expect((logs[0]!.afterSnapshot as { relations: unknown }).relations).toEqual(relations);
        expect(
          (logs[0]!.beforeSnapshot as { relations: unknown } | null)?.relations ?? null,
        ).toBeNull();
      }
    });
  });

  it('supplement:仅追加新点(origin=supplement),已有点不动', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const xId = await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, {
        requirements: [],
        supplements: goodDraft.supplements,
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(runId, undefined, 'human');
      expect(created).toHaveLength(0);
      const points = await db
        .select()
        .from(requirementPoints)
        .where(eq(requirementPoints.requirementId, xId));
      expect(points).toHaveLength(2);
      expect(points.find((p) => p.title === '补充点S')).toMatchObject({
        origin: 'supplement',
        status: 'draft',
      });
      expect(points.find((p) => p.title === 'X1')).toMatchObject({
        status: 'confirmed',
        evidences: [{ material_id: 'm1', quote: '旧原文' }],
      });
    });
  });

  it('resolution 与冲突类型不匹配抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[2]!],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      try {
        await svc.applyAnalysisRun(
          runId,
          { decisions: [{ requirementTitle: '相悖块C', resolution: 'merge' }] },
          'human',
        );
        expect.unreachable('应当抛 VALIDATION_ERROR');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  it('duplicate create_anyway 多点:新 2 点 × 目标 2 点双向 relations 完整不覆盖', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const x = await seedReqWithPoints(db, projectId, ['X1', 'X2']);
      const runId = await seedDraft(db, projectId, {
        requirements: [
          {
            title: '重复块B',
            summary: '',
            conflict: { type: 'duplicate', target_requirement_title: '已有需求X', reason: '' },
            points: [
              { title: 'N1', description: '', confidence: 0.8, evidences: [] },
              { title: 'N2', description: '', confidence: 0.8, evidences: [] },
            ],
          },
        ],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(
        runId,
        { decisions: [{ requirementTitle: '重复块B', resolution: 'create_anyway' }] },
        'human',
      );
      expect(created).toHaveLength(1);
      const newPoints = await db
        .select()
        .from(requirementPoints)
        .where(eq(requirementPoints.requirementId, created[0]!.id));
      const oldPoints = await db
        .select()
        .from(requirementPoints)
        .where(eq(requirementPoints.requirementId, x.reqId));
      expect(newPoints).toHaveLength(2);
      expect(oldPoints).toHaveLength(2);
      const oldIds = oldPoints.map((p) => p.id).sort();
      const newIds = newPoints.map((p) => p.id).sort();
      for (const p of newPoints) {
        expect(p.relations).toHaveLength(2);
        expect(p.relations!.map((r) => r.point_id).sort()).toEqual(oldIds);
        expect(p.relations!.every((r) => r.type === 'duplicate')).toBe(true);
      }
      for (const p of oldPoints) {
        expect(p.relations).toHaveLength(2);
        expect(p.relations!.map((r) => r.point_id).sort()).toEqual(newIds);
        expect(p.relations!.every((r) => r.type === 'duplicate')).toBe(true);
      }
    });
  });

  it('keep_both 多点:新 2 点 × 目标 2 点双向 relations 完整不覆盖', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const x = await seedReqWithPoints(db, projectId, ['X1', 'X2']);
      const runId = await seedDraft(db, projectId, {
        requirements: [
          {
            title: '相悖块C',
            summary: '',
            conflict: { type: 'contradiction', target_requirement_title: '已有需求X', reason: '' },
            points: [
              { title: 'N1', description: '', confidence: 0.7, evidences: [] },
              { title: 'N2', description: '', confidence: 0.7, evidences: [] },
            ],
          },
        ],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(
        runId,
        { decisions: [{ requirementTitle: '相悖块C', resolution: 'keep_both' }] },
        'human',
      );
      expect(created).toHaveLength(1);
      const newPoints = await db
        .select()
        .from(requirementPoints)
        .where(eq(requirementPoints.requirementId, created[0]!.id));
      const oldPoints = await db
        .select()
        .from(requirementPoints)
        .where(eq(requirementPoints.requirementId, x.reqId));
      expect(newPoints).toHaveLength(2);
      expect(oldPoints).toHaveLength(2);
      const oldIds = oldPoints.map((p) => p.id).sort();
      const newIds = newPoints.map((p) => p.id).sort();
      for (const p of newPoints) {
        expect(p.relations).toHaveLength(2);
        expect(p.relations!.map((r) => r.point_id).sort()).toEqual(oldIds);
        expect(p.relations!.every((r) => r.type === 'conflict')).toBe(true);
      }
      for (const p of oldPoints) {
        expect(p.relations).toHaveLength(2);
        expect(p.relations!.map((r) => r.point_id).sort()).toEqual(newIds);
        expect(p.relations!.every((r) => r.type === 'conflict')).toBe(true);
      }
    });
  });
});

describe('reviseDraft', () => {
  const reviseBlock = {
    title: '导出需求',
    summary: '支持多种格式导出',
    points: [
      {
        title: '导出 CSV',
        description: '导出为 CSV 格式',
        confidence: 0.8,
        evidences: [{ material_id: 'm1', quote: '要能导出 CSV' }],
      },
      { title: '导出 Excel', description: '导出为 Excel 格式', confidence: 0.6, evidences: [] },
    ],
  };

  async function seedProject(db: ShipmateDb): Promise<string> {
    const now = Date.now();
    return (
      await db
        .insert(projects)
        .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
        .returning()
    )[0]!.id;
  }

  async function seedDoneRun(db: ShipmateDb, projectId: string, draft: unknown): Promise<string> {
    const now = Date.now();
    return (
      await db
        .insert(analysisRuns)
        .values({
          id: newId(),
          projectId,
          title: '批次',
          status: 'done',
          actor: 'human',
          draftResult: draft as never,
          createdAt: now,
          completedAt: now,
        })
        .returning()
    )[0]!.id;
  }

  async function getRun(db: ShipmateDb, runId: string) {
    return (await db.select().from(analysisRuns).where(eq(analysisRuns.id, runId)))[0]!;
  }

  it('点级修订:user 含当前点与批注;点被替换;revisions 追加;change_logs update 记录批注', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const runId = await seedDoneRun(db, projectId, {
        requirements: [reviseBlock],
        supplements: [],
      });
      const llm = vi.fn(async (_system: string, _user: string) => ({
        title: '导出 CSV(支持自定义表头)',
        description: '导出 CSV,可自定义表头与分隔符',
        confidence: 0.9,
        evidences: [],
      }));
      const svc = makeService(db, llm);
      const { run, revised: rawRevised } = await svc.reviseDraft(
        runId,
        { blockIndex: 0, pointIndex: 0 },
        '  加上表头说明  ',
        undefined,
        'human',
      );
      const revised = rawRevised as DraftPoint;
      expect(llm).toHaveBeenCalledTimes(1);
      const user = String(llm.mock.calls[0]![1]);
      expect(user).toContain('导出 CSV'); // 当前点内容
      expect(user).toContain('加上表头说明'); // 批注(已 trim)
      expect(String(llm.mock.calls[0]![0])).toContain('需求点'); // 点级 system

      expect(revised).toMatchObject({ title: '导出 CSV(支持自定义表头)', confidence: 0.9 });
      expect(run.status).toBe('done');

      const draft = (await getRun(db, runId)).draftResult as {
        requirements: { title: string; points: { title: string }[]; revisions: unknown[] }[];
      };
      const block = draft.requirements[0]!;
      expect(block.points[0]).toMatchObject({ title: '导出 CSV(支持自定义表头)' });
      expect(block.points[1]!.title).toBe('导出 Excel'); // 兄弟点不动
      expect(block.revisions).toEqual([
        {
          at: expect.any(Number),
          actor: 'human',
          annotation: '加上表头说明',
          scope: 'point',
          pointTitle: '导出 CSV(支持自定义表头)',
        },
      ]);

      const logs = await db
        .select()
        .from(changeLogs)
        .where(and(eq(changeLogs.entityId, runId), eq(changeLogs.changeType, 'update')));
      expect(logs).toHaveLength(1);
      expect(logs[0]!.entityType).toBe('analysis_run');
      expect(logs[0]!.reason).toBe('AI 修订(需求点「导出 CSV(支持自定义表头)」):加上表头说明');
      expect(logs[0]!.actor).toBe('human');
      expect((logs[0]!.beforeSnapshot as { title: string }).title).toBe('导出需求');
      expect((logs[0]!.afterSnapshot as { revisions: unknown[] }).revisions).toHaveLength(1);
    });
  });

  it('keepEvidences 默认 true:LLM 返回空 evidences,写回仍保留原 evidences', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const runId = await seedDoneRun(db, projectId, {
        requirements: [reviseBlock],
        supplements: [],
      });
      const llm = vi.fn(async () => ({
        title: '导出 CSV',
        description: '改写后的描述',
        confidence: 0.95,
        evidences: [],
      }));
      const svc = makeService(db, llm);
      const { revised: rawRevised } = await svc.reviseDraft(
        runId,
        { blockIndex: 0, pointIndex: 0 },
        '改写描述',
        undefined,
        'human',
      );
      expect((rawRevised as DraftPoint).evidences).toEqual([
        { material_id: 'm1', quote: '要能导出 CSV' },
      ]);
      const draft = (await getRun(db, runId)).draftResult as {
        requirements: { points: { evidences: unknown }[] }[];
      };
      expect(draft.requirements[0]!.points[0]!.evidences).toEqual([
        { material_id: 'm1', quote: '要能导出 CSV' },
      ]);
    });
  });

  it('keepEvidences=false:LLM 返回空 evidences → 写回为空', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const runId = await seedDoneRun(db, projectId, {
        requirements: [reviseBlock],
        supplements: [],
      });
      const llm = vi.fn(async () => ({
        title: '导出 CSV',
        description: '改写后的描述',
        confidence: 0.95,
        evidences: [],
      }));
      const svc = makeService(db, llm);
      const { revised: rawRevised } = await svc.reviseDraft(
        runId,
        { blockIndex: 0, pointIndex: 0 },
        '改写描述并清空依据',
        { keepEvidences: false },
        'human',
      );
      expect((rawRevised as DraftPoint).evidences).toEqual([]);
      const draft = (await getRun(db, runId)).draftResult as {
        requirements: { points: { evidences: unknown }[] }[];
      };
      expect(draft.requirements[0]!.points[0]!.evidences).toEqual([]);
    });
  });

  it('块级修订:整块含 points 被替换;同名点 evidences 以原为准;revisions 追加 scope=block', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const runId = await seedDoneRun(db, projectId, {
        requirements: [reviseBlock],
        supplements: [],
      });
      const llm = vi.fn(async (_system: string, _user: string) => ({
        title: '导出需求(增强)',
        summary: '支持多种格式导出并可配置',
        points: [
          { title: '导出 CSV', description: '重写后的 CSV 描述', confidence: 0.9, evidences: [] },
          { title: '导出 PDF', description: '新增点', confidence: 0.7, evidences: [] },
        ],
      }));
      const svc = makeService(db, llm);
      const { revised: rawRevised } = await svc.reviseDraft(
        runId,
        { blockIndex: 0 },
        '整体重写,细化 CSV 并新增 PDF',
        undefined,
        'human',
      );
      const revised = rawRevised as DraftRequirement;
      expect(String(llm.mock.calls[0]![0])).toContain('需求块'); // 块级 system
      expect(revised).toMatchObject({ title: '导出需求(增强)' });

      const draft = (await getRun(db, runId)).draftResult as {
        requirements: {
          title: string;
          points: { title: string; evidences: { material_id: string }[] }[];
          revisions: { scope: string; pointTitle?: string }[];
        }[];
      };
      const block = draft.requirements[0]!;
      expect(block.title).toBe('导出需求(增强)');
      expect(block.points.map((p) => p.title)).toEqual(['导出 CSV', '导出 PDF']);
      // 同名点 evidences 以原为准;LLM 新增点保留 LLM 输出
      expect(block.points[0]!.evidences).toEqual([{ material_id: 'm1', quote: '要能导出 CSV' }]);
      expect(block.points[1]!.evidences).toEqual([]);
      expect(block.revisions).toEqual([
        {
          at: expect.any(Number),
          actor: 'human',
          annotation: '整体重写,细化 CSV 并新增 PDF',
          scope: 'block',
        },
      ]);
      expect(revised.points[0]!.evidences).toEqual([{ material_id: 'm1', quote: '要能导出 CSV' }]);
    });
  });

  it('校验:run 不存在 NOT_FOUND;无草稿/块越界/点越界/空批注 VALIDATION_ERROR;均不触发 LLM', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const llm = vi.fn(async () => ({}));
      const svc = makeService(db, llm);

      await expect(
        svc.reviseDraft('missing', { blockIndex: 0, pointIndex: 0 }, '批注', undefined, 'human'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const empty = await svc.createAnalysisRun({ projectId }, 'human');
      await expect(
        svc.reviseDraft(empty.id, { blockIndex: 0 }, '批注', undefined, 'human'),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining('没有分析草稿'),
      });

      const runId = await seedDoneRun(db, projectId, {
        requirements: [reviseBlock],
        supplements: [],
      });
      await expect(
        svc.reviseDraft(runId, { blockIndex: 9 }, '批注', undefined, 'human'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(
        svc.reviseDraft(runId, { blockIndex: 0, pointIndex: 9 }, '批注', undefined, 'human'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(
        svc.reviseDraft(runId, { blockIndex: 0 }, '   ', undefined, 'human'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(llm).not.toHaveBeenCalled();
    });
  });

  it('LLM 抛 LLM_ERROR → 冒泡且草稿、状态、change_logs 零改动', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const seedDraft = { requirements: [reviseBlock], supplements: [] };
      const runId = await seedDoneRun(db, projectId, seedDraft);
      const svc = makeService(db, async () => {
        throw new DomainError('LLM_ERROR', '超时');
      });
      await expect(
        svc.reviseDraft(runId, { blockIndex: 0, pointIndex: 0 }, '批注', undefined, 'human'),
      ).rejects.toMatchObject({ code: 'LLM_ERROR' });

      const run = await getRun(db, runId);
      expect(run.status).toBe('done'); // 批次状态不变
      expect(run.draftResult).toEqual(seedDraft); // 草稿不动
      expect(
        await db
          .select()
          .from(changeLogs)
          .where(and(eq(changeLogs.entityId, runId), eq(changeLogs.changeType, 'update'))),
      ).toHaveLength(0);
    });
  });

  it('LLM 产出不合 schema → LLM_SCHEMA_MISMATCH,草稿不动', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const seedDraft = { requirements: [reviseBlock], supplements: [] };
      const runId = await seedDoneRun(db, projectId, seedDraft);
      const svc = makeService(db, async () => ({ wrong: 'shape' }));
      await expect(
        svc.reviseDraft(runId, { blockIndex: 0 }, '批注', undefined, 'human'),
      ).rejects.toMatchObject({ code: 'LLM_SCHEMA_MISMATCH' });
      expect((await getRun(db, runId)).draftResult).toEqual(seedDraft);
    });
  });
});

describe('reviseDraftStream', () => {
  const reviseBlock = {
    title: '导出需求',
    summary: '支持多种格式导出',
    points: [
      {
        title: '导出 CSV',
        description: '导出为 CSV 格式',
        confidence: 0.8,
        evidences: [{ material_id: 'm1', quote: '要能导出 CSV' }],
      },
      { title: '导出 Excel', description: '导出为 Excel 格式', confidence: 0.6, evidences: [] },
    ],
  };

  async function seedProject(db: ShipmateDb): Promise<string> {
    const now = Date.now();
    return (
      await db
        .insert(projects)
        .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
        .returning()
    )[0]!.id;
  }

  async function seedDoneRun(db: ShipmateDb, projectId: string, draft: unknown): Promise<string> {
    const now = Date.now();
    return (
      await db
        .insert(analysisRuns)
        .values({
          id: newId(),
          projectId,
          title: '批次',
          status: 'done',
          actor: 'human',
          draftResult: draft as never,
          createdAt: now,
          completedAt: now,
        })
        .returning()
    )[0]!.id;
  }

  async function getRun(db: ShipmateDb, runId: string) {
    return (await db.select().from(analysisRuns).where(eq(analysisRuns.id, runId)))[0]!;
  }

  /** fake 流式 invoker:按序 onDelta 若干增量后返回完整 JSON */
  function fakeStreamInvoker(payload: unknown) {
    const json = JSON.stringify(payload);
    const chunks = [json.slice(0, 24), json.slice(24, 48), json.slice(48)].filter(
      (c) => c.length > 0,
    );
    return vi.fn(
      async (
        _system: string,
        _user: string,
        h: { onDelta?: (deltaText: string, fullText: string) => void; signal?: AbortSignal },
      ) => {
        let full = '';
        for (const c of chunks) {
          full += c;
          h.onDelta?.(c, full);
        }
        return JSON.parse(full);
      },
    );
  }

  it('点级:stage×3 → delta×N → stage×2 → done 事件按序;signal 透传;写回/日志/revisions 与 reviseDraft 一致', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const seedDraft = { requirements: [reviseBlock], supplements: [] };
      const runId = await seedDoneRun(db, projectId, seedDraft);
      const revisedPoint = {
        title: '导出 CSV(支持自定义表头)',
        description: '导出 CSV,可自定义表头与分隔符',
        confidence: 0.9,
        evidences: [],
      };
      const llmStream = fakeStreamInvoker(revisedPoint);
      const svc = makeService(db, async () => ({}), llmStream);

      const events: ReviseStreamEvent[] = [];
      const controller = new AbortController();
      const { run, revised: rawRevised } = await svc.reviseDraftStream(
        runId,
        { blockIndex: 0, pointIndex: 0 },
        '  加上表头说明  ',
        undefined,
        'human',
        { onEvent: (e) => events.push(e), signal: controller.signal },
      );
      const revised = rawRevised as DraftPoint;

      // 事件类型序列:stage×3 → delta×3 → stage×2 → done
      expect(events.map((e) => e.type)).toEqual([
        'stage',
        'stage',
        'stage',
        'delta',
        'delta',
        'delta',
        'stage',
        'stage',
        'done',
      ]);
      // stage 消息按序且与原型日志区一致
      expect(
        events.filter((e) => e.type === 'stage').map((e) => (e as { message: string }).message),
      ).toEqual([
        '解析批注',
        '识别修订意图(对照已有需求摘要)',
        '重写需求点',
        '校验溯源与依据保留',
        '终稿生成',
      ]);
      // delta 事件 text 为增量,拼接即完整 JSON;done 携带终稿
      const fullFromDeltas = events
        .filter((e) => e.type === 'delta')
        .map((e) => (e as { text: string }).text)
        .join('');
      expect(fullFromDeltas).toBe(JSON.stringify(revisedPoint));
      // done 携带终稿(keepEvidences 回填后,与返回值同源同引用)
      expect(events.at(-1)).toEqual({ type: 'done', revised });
      // signal 原样透传给流式 invoker
      expect(llmStream.mock.calls[0]![2].signal).toBe(controller.signal);

      // 返回值与写回:与 reviseDraft 同行为
      expect(revised).toMatchObject({ title: '导出 CSV(支持自定义表头)', confidence: 0.9 });
      // keepEvidences 默认 true:LLM 空 evidences,写回保留原依据
      expect(revised.evidences).toEqual([{ material_id: 'm1', quote: '要能导出 CSV' }]);
      expect(run.status).toBe('done');

      const draft = (await getRun(db, runId)).draftResult as {
        requirements: { title: string; points: { title: string }[]; revisions: unknown[] }[];
      };
      const block = draft.requirements[0]!;
      expect(block.points[0]).toMatchObject({ title: '导出 CSV(支持自定义表头)' });
      expect(block.points[1]!.title).toBe('导出 Excel'); // 兄弟点不动
      expect(block.revisions).toEqual([
        {
          at: expect.any(Number),
          actor: 'human',
          annotation: '加上表头说明',
          scope: 'point',
          pointTitle: '导出 CSV(支持自定义表头)',
        },
      ]);

      const logs = await db
        .select()
        .from(changeLogs)
        .where(and(eq(changeLogs.entityId, runId), eq(changeLogs.changeType, 'update')));
      expect(logs).toHaveLength(1);
      expect(logs[0]!.reason).toBe('AI 修订(需求点「导出 CSV(支持自定义表头)」):加上表头说明');
    });
  });

  it('块级:stage 含「重写需求块」;整块替换且同名点 evidences 以原为准', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const runId = await seedDoneRun(db, projectId, {
        requirements: [reviseBlock],
        supplements: [],
      });
      const llmStream = fakeStreamInvoker({
        title: '导出需求(增强)',
        summary: '支持多种格式导出并可配置',
        points: [
          { title: '导出 CSV', description: '重写后的 CSV 描述', confidence: 0.9, evidences: [] },
          { title: '导出 PDF', description: '新增点', confidence: 0.7, evidences: [] },
        ],
      });
      const svc = makeService(db, async () => ({}), llmStream);

      const events: ReviseStreamEvent[] = [];
      const { revised: rawRevised } = await svc.reviseDraftStream(
        runId,
        { blockIndex: 0 },
        '整体重写',
        undefined,
        'human',
        { onEvent: (e) => events.push(e) },
      );
      expect(
        events.filter((e) => e.type === 'stage').map((e) => (e as { message: string }).message),
      ).toContain('重写需求块');
      const revised = rawRevised as DraftRequirement;
      expect(revised).toMatchObject({ title: '导出需求(增强)' });

      const draft = (await getRun(db, runId)).draftResult as {
        requirements: {
          title: string;
          points: { title: string; evidences: unknown[] }[];
          revisions: { scope: string }[];
        }[];
      };
      const block = draft.requirements[0]!;
      expect(block.title).toBe('导出需求(增强)');
      expect(block.points.map((p) => p.title)).toEqual(['导出 CSV', '导出 PDF']);
      expect(block.points[0]!.evidences).toEqual([{ material_id: 'm1', quote: '要能导出 CSV' }]);
      expect(block.points[1]!.evidences).toEqual([]);
      expect(block.revisions).toEqual([expect.objectContaining({ scope: 'block' })]);
    });
  });

  it('校验失败不发任何事件:run 不存在 NOT_FOUND', async () => {
    await withDb(async (db) => {
      await seedProject(db);
      const svc = makeService(db, async () => ({}), fakeStreamInvoker({}));
      const events: ReviseStreamEvent[] = [];
      await expect(
        svc.reviseDraftStream('missing', { blockIndex: 0 }, '批注', undefined, 'human', {
          onEvent: (e) => events.push(e),
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(events).toEqual([]);
    });
  });

  it('AbortError 原样冒泡:草稿零改动、零日志、状态不变;已发的 delta 不产生副作用', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const seedDraft = { requirements: [reviseBlock], supplements: [] };
      const runId = await seedDoneRun(db, projectId, seedDraft);
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const llmStream = vi.fn(
        async (
          _system: string,
          _user: string,
          h: { onDelta?: (deltaText: string, fullText: string) => void },
        ) => {
          h.onDelta?.('{"ti', '{"ti');
          throw abortError;
        },
      );
      const svc = makeService(db, async () => ({}), llmStream);
      const events: ReviseStreamEvent[] = [];
      await expect(
        svc.reviseDraftStream(runId, { blockIndex: 0, pointIndex: 0 }, '批注', undefined, 'human', {
          onEvent: (e) => events.push(e),
          signal: new AbortController().signal,
        }),
      ).rejects.toBe(abortError); // 原样 rethrow,未包装成 LLM_ERROR

      // 中断前已发 stage×3 与 1 条 delta,但草稿与日志零改动
      expect(events.map((e) => e.type)).toEqual(['stage', 'stage', 'stage', 'delta']);
      const run = await getRun(db, runId);
      expect(run.status).toBe('done');
      expect(run.draftResult).toEqual(seedDraft);
      expect(await db.select().from(changeLogs).where(eq(changeLogs.entityId, runId))).toHaveLength(
        0,
      );
    });
  });
});
