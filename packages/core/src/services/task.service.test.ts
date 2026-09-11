import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import {
  changeLogs,
  projects,
  requirementPoints,
  requirements,
  type TaskRow,
} from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { TaskService } from './task.service.js';

/** 测试辅助:绕过状态机直接置状态(模拟联动结果) */
async function forceTaskStatus(db: ShipmateDb, taskId: string, status: TaskRow['status']) {
  await db.execute(sql`UPDATE tasks SET status = ${status} WHERE id = ${taskId}`);
}

/** 测试辅助:建一条需求点链(project → requirement → point),返回 pointId */
async function seedPoint(db: ShipmateDb): Promise<string> {
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
  const pt = (
    await db
      .insert(requirementPoints)
      .values({
        id: newId(),
        requirementId: r.id,
        title: 'PT',
        status: 'draft',
        version: 1,
        sourceMaterialIds: [],
        evidences: [],
        origin: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;
  return pt.id;
}

describe('TaskService', () => {
  it('createTask:默认 pending/sortOrder 0;需求点不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = new TaskService(db);
      const pointId = await seedPoint(db);
      const t = await svc.createTask({ requirementPointId: pointId, title: '写迁移脚本' }, 'human');
      expect(t).toMatchObject({ status: 'pending', sortOrder: 0, commitRefs: [] });
      try {
        await svc.createTask({ requirementPointId: 'missing', title: 'x' }, 'human');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('状态机:pending→in_progress→done 合法;跳跃与回退非法', async () => {
    await withDb(async (db) => {
      const svc = new TaskService(db);
      const pointId = await seedPoint(db);
      const t = await svc.createTask({ requirementPointId: pointId, title: 'T' }, 'human');
      expect((await svc.setTaskStatus(t.id, 'start', 'human')).status).toBe('in_progress');
      expect((await svc.setTaskStatus(t.id, 'complete', 'human')).status).toBe('done');
      for (const action of ['complete', 'start'] as const) {
        try {
          await svc.setTaskStatus(t.id, action, 'human');
          expect.unreachable(`应当抛错:${action}`);
        } catch (e) {
          expect((e as DomainError).code).toBe('INVALID_STATUS_TRANSITION');
        }
      }
    });
  });

  it('confirmTaskReassessment:needs_reassessment 回 pending;其他状态抛错', async () => {
    await withDb(async (db) => {
      const svc = new TaskService(db);
      const pointId = await seedPoint(db);
      const t = await svc.createTask({ requirementPointId: pointId, title: 'T' }, 'human');
      await forceTaskStatus(db, t.id, 'needs_reassessment');
      const ok = await svc.confirmTaskReassessment(t.id, 'mcp:claude-code');
      expect(ok.status).toBe('pending');
      try {
        await svc.confirmTaskReassessment(t.id, 'human');
        expect.unreachable('应当抛错');
      } catch (e) {
        expect((e as DomainError).code).toBe('INVALID_STATUS_TRANSITION');
      }
    });
  });

  it('updateTask:title 变化记 update log', async () => {
    await withDb(async (db) => {
      const svc = new TaskService(db);
      const pointId = await seedPoint(db);
      const t = await svc.createTask({ requirementPointId: pointId, title: '旧' }, 'human');
      await svc.updateTask(t.id, { title: '新', sortOrder: 3 }, 'human');
      const log = await db.select().from(changeLogs).where(eq(changeLogs.changeType, 'update'));
      expect(log).toHaveLength(1);
    });
  });

  it('listTasks:按需求点/状态过滤;按项目过滤走联表', async () => {
    await withDb(async (db) => {
      const svc = new TaskService(db);
      const pointId = await seedPoint(db);
      await svc.createTask({ requirementPointId: pointId, title: 'T1' }, 'human');
      await svc.createTask({ requirementPointId: pointId, title: 'T2', sortOrder: 1 }, 'human');
      const t3 = await svc.createTask(
        { requirementPointId: pointId, title: 'T3', sortOrder: 2 },
        'human',
      );
      await svc.setTaskStatus(t3.id, 'start', 'human');

      expect(await svc.listTasks({ requirementPointId: pointId })).toHaveLength(3);
      expect(
        (await svc.listTasks({ requirementPointId: pointId, status: 'in_progress' })).map(
          (t) => t.title,
        ),
      ).toEqual(['T3']);
      const point = (
        await db.select().from(requirementPoints).where(eq(requirementPoints.id, pointId))
      )[0]!;
      const req = (
        await db.select().from(requirements).where(eq(requirements.id, point.requirementId))
      )[0]!;
      expect(await svc.listTasks({ projectId: req.projectId })).toHaveLength(3);
    });
  });
});
