import { describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import {
  analysisRuns,
  changeLogs,
  materials,
  projects,
  requirementPoints,
  requirements,
  groups,
  tasks,
} from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { ProjectService } from './project.service.js';

async function seedGroup(db: ShipmateDb): Promise<string> {
  const now = Date.now();
  const rows = await db
    .insert(groups)
    .values({ id: newId(), name: 'G', sortOrder: 0, createdAt: now, updatedAt: now })
    .returning();
  return rows[0]!.id;
}

describe('ProjectService', () => {
  it('createProject:入组/不入组均可;groupId 不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = new ProjectService(db);
      const gid = await seedGroup(db);
      const p1 = await svc.createProject({ groupId: gid, name: '已入组项目' }, 'human');
      const p2 = await svc.createProject({ name: '未入组项目' }, 'human');
      expect(p1.groupId).toBe(gid);
      expect(p2.groupId).toBeNull();
      try {
        await svc.createProject({ groupId: 'missing', name: 'x' }, 'human');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('updateProject:status 变更写 status_change,名称变更写 update', async () => {
    await withDb(async (db) => {
      const svc = new ProjectService(db);
      const p = await svc.createProject({ name: '项目A' }, 'human');
      await svc.updateProject(p.id, { name: '项目A2' }, 'human');
      await svc.updateProject(p.id, { status: 'archived' }, 'human');
      const logs = await db.select().from(changeLogs).where(eq(changeLogs.entityId, p.id));
      const types = logs.map((l) => l.changeType);
      expect(types).toContain('create');
      expect(types).toContain('update');
      expect(types).toContain('status_change');
    });
  });

  it('updateProject:description-only 变更也写恰 1 条 update log,快照含前后值', async () => {
    await withDb(async (db) => {
      const svc = new ProjectService(db);
      const p = await svc.createProject({ name: '项目D', description: '旧描述' }, 'human');
      await svc.updateProject(p.id, { description: '新描述' }, 'human');
      const logs = await db.select().from(changeLogs).where(eq(changeLogs.entityId, p.id));
      expect(logs.every((l) => l.changeType !== 'status_change')).toBe(true);
      const updateLogs = logs.filter((l) => l.changeType === 'update');
      expect(updateLogs).toHaveLength(1);
      expect(updateLogs[0]!.beforeSnapshot).toMatchObject({ name: '项目D', description: '旧描述' });
      expect(updateLogs[0]!.afterSnapshot).toMatchObject({ name: '项目D', description: '新描述' });
    });
  });

  it('getProject:完成度/点状态分布/超期数/最近变更', async () => {
    await withDb(async (db) => {
      const svc = new ProjectService(db);
      const p = await svc.createProject({ name: '项目B' }, 'human');
      const now = Date.now();
      const day = 86_400_000;
      const mkReq = (status: 'draft' | 'confirmed' | 'done', planDueAt?: number) =>
        db
          .insert(requirements)
          .values({
            id: newId(),
            projectId: p.id,
            title: `R-${Math.random()}`,
            status,
            priority: 'P2',
            planDueAt: planDueAt ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
      const doneReq = await mkReq('done');
      await mkReq('confirmed', now - 10 * day); // 超期
      await mkReq('draft');
      const now2 = Date.now();
      await db.insert(requirementPoints).values([
        {
          id: newId(),
          requirementId: doneReq[0]!.id,
          title: 't1',
          status: 'done',
          version: 1,
          sourceMaterialIds: [],
          evidences: [],
          origin: 'manual',
          createdAt: now2,
          updatedAt: now2,
        },
        {
          id: newId(),
          requirementId: doneReq[0]!.id,
          title: 't2',
          status: 'developing',
          version: 1,
          sourceMaterialIds: [],
          evidences: [],
          origin: 'manual',
          createdAt: now2,
          updatedAt: now2,
        },
      ]);

      const s = await svc.getProject(p.id);
      expect(s.requirementTotal).toBe(3);
      expect(s.requirementDone).toBe(1);
      expect(s.overdueRequirementCount).toBe(1);
      expect(s.pointStatusCounts).toEqual({ draft: 0, confirmed: 0, developing: 1, done: 1 });
      expect(s.recentChanges.length).toBeGreaterThan(0);

      try {
        await svc.getProject('missing');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('listProjects:全部 / 按组 / 未分组(null)', async () => {
    await withDb(async (db) => {
      const svc = new ProjectService(db);
      // 共享真实库,断言用相对计数 diff,不假设全表初值
      const beforeAll = (await svc.listProjects()).length;
      const beforeUngrouped = (await svc.listProjects({ groupId: null })).length;
      const gid = await seedGroup(db);
      await svc.createProject({ groupId: gid, name: '在组内' }, 'human');
      await svc.createProject({ name: '不在组内' }, 'human');
      expect((await svc.listProjects()).length - beforeAll).toBe(2);
      // 本用例自建组,gid 天然隔离,可精确断言
      expect(await svc.listProjects({ groupId: gid })).toHaveLength(1);
      expect((await svc.listProjects({ groupId: null })).length - beforeUngrouped).toBe(1);
    });
  });

  it('deleteProject:单事务级联删除五表,change_logs 保留并追加 delete 留痕', async () => {
    await withDb(async (db) => {
      const svc = new ProjectService(db);
      const p = await svc.createProject({ name: '待删项目X' }, 'human');
      const now = Date.now();

      // 全链数据:分析批次 x2 + 素材 x3 + 需求 x2 + 需求点 x3 + 任务 x2
      const runs = await db
        .insert(analysisRuns)
        .values([
          {
            id: newId(),
            projectId: p.id,
            status: 'pending',
            actor: 'human',
            createdAt: now,
          },
          {
            id: newId(),
            projectId: p.id,
            title: '批次B',
            status: 'done',
            actor: 'human',
            createdAt: now,
            completedAt: now,
          },
        ])
        .returning();
      await db.insert(materials).values([
        {
          id: newId(),
          projectId: p.id,
          analysisRunId: runs[0]!.id,
          type: 'paste_text',
          rawContent: 'a',
          actor: 'human',
          createdAt: now,
        },
        {
          id: newId(),
          projectId: p.id,
          analysisRunId: runs[0]!.id,
          type: 'doc',
          rawContent: 'b',
          actor: 'human',
          createdAt: now,
        },
        {
          id: newId(),
          projectId: p.id,
          analysisRunId: runs[1]!.id,
          type: 'screenshot_text',
          rawContent: 'c',
          actor: 'human',
          createdAt: now,
        },
      ]);
      const reqs = await db
        .insert(requirements)
        .values([
          {
            id: newId(),
            projectId: p.id,
            title: 'R1',
            status: 'confirmed',
            priority: 'P1',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: newId(),
            projectId: p.id,
            title: 'R2',
            status: 'draft',
            priority: 'P2',
            createdAt: now,
            updatedAt: now,
          },
        ])
        .returning();
      const pts = await db
        .insert(requirementPoints)
        .values([
          {
            id: newId(),
            requirementId: reqs[0]!.id,
            title: 'p1',
            status: 'draft',
            version: 1,
            sourceMaterialIds: [],
            evidences: [],
            origin: 'manual',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: newId(),
            requirementId: reqs[0]!.id,
            title: 'p2',
            status: 'done',
            version: 1,
            sourceMaterialIds: [],
            evidences: [],
            origin: 'manual',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: newId(),
            requirementId: reqs[1]!.id,
            title: 'p3',
            status: 'developing',
            version: 1,
            sourceMaterialIds: [],
            evidences: [],
            origin: 'manual',
            createdAt: now,
            updatedAt: now,
          },
        ])
        .returning();
      await db.insert(tasks).values([
        {
          id: newId(),
          requirementPointId: pts[0]!.id,
          title: 't1',
          status: 'pending',
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: newId(),
          requirementPointId: pts[2]!.id,
          title: 't2',
          status: 'in_progress',
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const cascade = await svc.deleteProject(p.id, 'human');
      expect(cascade).toEqual({ requirements: 2, points: 3, tasks: 2, runs: 2, materials: 3 });

      // 共享真实库:各表按本项目 id/id 集合过滤断言为空
      expect(await db.select().from(projects).where(eq(projects.id, p.id))).toHaveLength(0);
      expect(
        await db.select().from(requirements).where(eq(requirements.projectId, p.id)),
      ).toHaveLength(0);
      expect(
        await db.select().from(analysisRuns).where(eq(analysisRuns.projectId, p.id)),
      ).toHaveLength(0);
      expect(await db.select().from(materials).where(eq(materials.projectId, p.id))).toHaveLength(
        0,
      );
      const reqIds = reqs.map((r) => r.id);
      const pointIds = pts.map((pt) => pt.id);
      expect(
        await db.select().from(requirementPoints).where(inArray(requirementPoints.id, pointIds)),
      ).toHaveLength(0);
      expect(
        await db.select().from(tasks).where(inArray(tasks.requirementPointId, pointIds)),
      ).toHaveLength(0);
      expect(
        await db.select().from(requirements).where(inArray(requirements.id, reqIds)),
      ).toHaveLength(0);

      // change_logs 历史保留:delete 前的 create log 仍在;删除本身留痕
      const logs = await db.select().from(changeLogs).where(eq(changeLogs.entityId, p.id));
      const types = logs.map((l) => l.changeType);
      expect(types).toContain('create');
      expect(types).toContain('delete');
      const del = logs.find((l) => l.changeType === 'delete')!;
      expect(del.entityType).toBe('project');
      expect(del.beforeSnapshot).toMatchObject({ id: p.id, name: '待删项目X' });
      expect(del.afterSnapshot).toEqual({ deleted: true, cascade });
      expect(del.reason).toBe('删除项目(级联)');
      expect(del.actor).toBe('human');
    });
  });

  it('deleteProject:空项目(无任何需求数据)级联统计全 0;项目不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = new ProjectService(db);
      const p = await svc.createProject({ name: '空项目Y' }, 'human');
      expect(await svc.deleteProject(p.id, 'human')).toEqual({
        requirements: 0,
        points: 0,
        tasks: 0,
        runs: 0,
        materials: 0,
      });
      try {
        await svc.deleteProject('ghost-project', 'human');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });
});
