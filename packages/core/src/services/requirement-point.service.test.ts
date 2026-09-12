import { describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import { changeLogs, projects, requirementPoints, requirements } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { TaskService } from './task.service.js';
import { RequirementPointService } from './requirement-point.service.js';

/** 测试辅助:建 project → requirement 链,返回 requirementId */
async function seedRequirement(db: ShipmateDb): Promise<string> {
  const now = Date.now();
  const p = (
    await db
      .insert(projects)
      .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
      .returning()
  )[0]!;
  const r = (
    await db
      .insert(requirements)
      .values({
        id: newId(),
        projectId: p.id,
        title: 'R',
        status: 'draft',
        priority: 'P2',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;
  return r.id;
}

async function seedPoint(
  db: ShipmateDb,
  reqId: string,
  status: 'draft' | 'confirmed' | 'developing' | 'done',
  version = 1,
): Promise<string> {
  const now = Date.now();
  const rows = await db
    .insert(requirementPoints)
    .values({
      id: newId(),
      requirementId: reqId,
      title: '点',
      description: '描述',
      status,
      version,
      sourceMaterialIds: [],
      evidences: [],
      origin: 'manual',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rows[0]!.id;
}

describe('RequirementPointService 状态机', () => {
  it('draft→confirm→start→complete 全链合法并记 status_change', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'draft');
      expect((await svc.setRequirementPointStatus(id, 'confirm', 'human')).status).toBe(
        'confirmed',
      );
      expect((await svc.setRequirementPointStatus(id, 'start', 'human')).status).toBe('developing');
      expect((await svc.setRequirementPointStatus(id, 'complete', 'human')).status).toBe('done');
      // 按 entityId 收窄:共享真实库中存在其他 status_change 日志
      const logs = await db
        .select()
        .from(changeLogs)
        .where(and(eq(changeLogs.changeType, 'status_change'), eq(changeLogs.entityId, id)));
      expect(logs).toHaveLength(3);
    });
  });

  it('非法流转抛 INVALID_STATUS_TRANSITION', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'draft');
      try {
        await svc.setRequirementPointStatus(id, 'start', 'human');
        expect.unreachable('应当抛错');
      } catch (e) {
        expect((e as DomainError).code).toBe('INVALID_STATUS_TRANSITION');
      }
    });
  });

  it('confirmRequirementPoint 是 confirm 别名', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'draft');
      expect((await svc.confirmRequirementPoint(id, 'mcp:claude-code')).status).toBe('confirmed');
    });
  });
});

describe('实质修改联动(spec §5.3)', () => {
  it('developing 点改标题:回 confirmed、version+1、任务打标、linkage_impact', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const taskSvc = new TaskService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'developing', 3);
      const t1 = await taskSvc.createTask({ requirementPointId: id, title: 'T1' }, 'human');
      const t2 = await taskSvc.createTask({ requirementPointId: id, title: 'T2' }, 'human');
      await taskSvc.setTaskStatus(t2.id, 'start', 'human');

      const result = await svc.updateRequirementPoint(
        id,
        { title: '改后的点', reason: '口径变化' },
        'human',
      );
      expect(result.affectedTaskCount).toBe(2);
      expect(result.point).toMatchObject({ status: 'confirmed', version: 4, title: '改后的点' });

      const allTasks = await taskSvc.listTasks({ requirementPointId: id });
      expect(allTasks.every((t) => t.status === 'needs_reassessment')).toBe(true);

      const kinds = (await db.select().from(changeLogs).where(eq(changeLogs.entityId, id))).map(
        (l) => l.changeType,
      );
      expect(kinds).toContain('update');
      expect(kinds).toContain('linkage_impact');
      // 收窄到本用例自建的两个任务:共享真实库中可能存在其他 task 日志
      const taskLogs = await db
        .select()
        .from(changeLogs)
        .where(inArray(changeLogs.entityId, [t1.id, t2.id]));
      // 3 条 = T2 start 1 条(TaskService.setTaskStatus 记 status_change)+ 联动打标 T1/T2 各 1 条
      expect(taskLogs.filter((l) => l.changeType === 'status_change')).toHaveLength(3);
    });
  });

  it('done 点改描述:同样回退 confirmed', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'done', 2);
      const result = await svc.updateRequirementPoint(id, { description: '新描述' }, 'human');
      expect(result.point).toMatchObject({ status: 'confirmed', version: 3 });
    });
  });

  it('draft 点实质修改:状态保持 draft,version+1,仍联动任务', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const taskSvc = new TaskService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'draft');
      await taskSvc.createTask({ requirementPointId: id, title: 'T1' }, 'human');
      const result = await svc.updateRequirementPoint(id, { title: 'draft 期修改' }, 'human');
      expect(result.point).toMatchObject({ status: 'draft', version: 2 });
      expect(result.affectedTaskCount).toBe(1);
    });
  });

  it('无实质变化时不写任何 log、不动 version', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'confirmed', 7);
      const beforeLogs = (await db.select().from(changeLogs)).length;
      const result = await svc.updateRequirementPoint(id, { title: '点' }, 'human');
      expect(result).toEqual({
        point: expect.objectContaining({ version: 7 }),
        affectedTaskCount: 0,
      });
      expect(await db.select().from(changeLogs)).toHaveLength(beforeLogs);
    });
  });

  it('已是 needs_reassessment 的任务不重复打标', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const taskSvc = new TaskService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'developing');
      const t = await taskSvc.createTask({ requirementPointId: id, title: 'T' }, 'human');
      await svc.updateRequirementPoint(id, { title: '改一' }, 'human');
      await svc.updateRequirementPoint(id, { title: '改二' }, 'human');
      const taskStatusLogs = (
        await db.select().from(changeLogs).where(eq(changeLogs.entityId, t.id))
      ).filter((l) => l.changeType === 'status_change');
      expect(taskStatusLogs).toHaveLength(1); // 第二轮因已是 needs_reassessment 被跳过
    });
  });

  it('点不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      try {
        await svc.updateRequirementPoint('missing', { title: 'x' }, 'human');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });
});

describe('查询', () => {
  it('getRequirementPoint 返回点 + 任务 + 变更历史', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const taskSvc = new TaskService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'draft');
      await svc.setRequirementPointStatus(id, 'confirm', 'human'); // 先产生一条 point 自身的变更历史
      await taskSvc.createTask({ requirementPointId: id, title: 'T' }, 'human');
      const detail = await svc.getRequirementPoint(id);
      expect(detail.point.id).toBe(id);
      expect(detail.tasks).toHaveLength(1);
      expect(detail.changeLogs.length).toBeGreaterThan(0);
      try {
        await svc.getRequirementPoint('missing');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('listRequirementPoints 按状态过滤,projectId 走联表', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const reqId = await seedRequirement(db);
      await seedPoint(db, reqId, 'draft');
      await seedPoint(db, reqId, 'done');
      expect(await svc.listRequirementPoints({ requirementId: reqId })).toHaveLength(2);
      expect(
        await svc.listRequirementPoints({ requirementId: reqId, status: 'done' }),
      ).toHaveLength(1);
      const req = (await db.select().from(requirements).where(eq(requirements.id, reqId)))[0]!;
      expect(await svc.listRequirementPoints({ projectId: req.projectId })).toHaveLength(2);
    });
  });
});
