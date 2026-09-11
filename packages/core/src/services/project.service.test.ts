import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import { changeLogs, requirementPoints, requirements, groups } from '../db/schema.js';
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
      const gid = await seedGroup(db);
      await svc.createProject({ groupId: gid, name: '在组内' }, 'human');
      await svc.createProject({ name: '不在组内' }, 'human');
      expect(await svc.listProjects()).toHaveLength(2);
      expect(await svc.listProjects({ groupId: gid })).toHaveLength(1);
      expect(await svc.listProjects({ groupId: null })).toHaveLength(1);
    });
  });
});
