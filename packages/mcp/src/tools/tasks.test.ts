import { describe, expect, it } from 'vitest';
import {
  createCore,
  newId,
  requirementPoints,
  withDb,
  type RequirementPointRow,
  type ShipmateDb,
} from '@shipmate/core';
import { callTool, setupServer } from '../test-helpers.js';

/** 造需求点:core 无独立 createPoint,测试直接落一行 */
async function seedPoint(
  db: ShipmateDb,
  requirementId: string,
  title: string,
  status: RequirementPointRow['status'] = 'draft',
): Promise<RequirementPointRow> {
  const now = Date.now();
  return (
    await db
      .insert(requirementPoints)
      .values({
        id: newId(),
        requirementId,
        title,
        status,
        version: 1,
        origin: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;
}

describe('任务工具', () => {
  it('tools/list 注册了全部任务工具', async () => {
    await withDb(async (db) => {
      const { client } = await setupServer(db);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const name of [
        'create_task',
        'update_task',
        'set_task_status',
        'list_tasks',
        'confirm_task_reassessment',
      ]) {
        expect(names).toContain(name);
      }
    });
  });

  it('create_task 落库为 pending 并记审计', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求' },
        'human',
      );
      const point = await seedPoint(db, req.id, '点');
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'create_task', {
        requirementPointId: point.id,
        title: '写迁移脚本',
        sortOrder: 3,
      });
      expect(isError).toBe(false);
      const created = JSON.parse(text);
      expect(created).toMatchObject({
        requirementPointId: point.id,
        title: '写迁移脚本',
        status: 'pending',
        sortOrder: 3,
      });
      const logs = await core.audit.getChangeLog({ entityType: 'task', entityId: created.id });
      expect(logs[0]).toMatchObject({ actor: 'mcp:test', changeType: 'create' });
    });
  });

  it('set_task_status 流转 pending→in_progress→done,非法流转 isError', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求' },
        'human',
      );
      const point = await seedPoint(db, req.id, '点');
      const task = await core.tasks.createTask(
        { requirementPointId: point.id, title: '任务' },
        'human',
      );
      const { client } = await setupServer(db);

      // pending → complete 非法
      const bad = await callTool(client, 'set_task_status', { id: task.id, action: 'complete' });
      expect(bad.isError).toBe(true);
      expect(bad.text).toContain('INVALID_STATUS_TRANSITION');

      const start = await callTool(client, 'set_task_status', { id: task.id, action: 'start' });
      expect(start.isError).toBe(false);
      expect(JSON.parse(start.text)).toMatchObject({ status: 'in_progress' });

      const done = await callTool(client, 'set_task_status', { id: task.id, action: 'complete' });
      expect(done.isError).toBe(false);
      expect(JSON.parse(done.text)).toMatchObject({ status: 'done' });
    });
  });

  it('update_task 修改标题与排序', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求' },
        'human',
      );
      const point = await seedPoint(db, req.id, '点');
      const task = await core.tasks.createTask(
        { requirementPointId: point.id, title: '旧标题' },
        'human',
      );
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'update_task', {
        id: task.id,
        title: '新标题',
        sortOrder: 9,
      });
      expect(isError).toBe(false);
      expect(JSON.parse(text)).toMatchObject({ title: '新标题', sortOrder: 9 });
    });
  });

  it('list_tasks 按 requirementPointId/projectId/status 过滤', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求' },
        'human',
      );
      const point1 = await seedPoint(db, req.id, '点一');
      const point2 = await seedPoint(db, req.id, '点二');
      const t1 = await core.tasks.createTask(
        { requirementPointId: point1.id, title: '任务甲' },
        'human',
      );
      await core.tasks.createTask({ requirementPointId: point2.id, title: '任务乙' }, 'human');
      const { client } = await setupServer(db);

      const byPoint = JSON.parse(
        (await callTool(client, 'list_tasks', { requirementPointId: point1.id })).text,
      );
      expect(byPoint.map((t: { title: string }) => t.title)).toEqual(['任务甲']);

      const byProject = JSON.parse(
        (await callTool(client, 'list_tasks', { projectId: project.id })).text,
      );
      expect(byProject).toHaveLength(2);

      const started = await core.tasks.setTaskStatus(t1.id, 'start', 'human');
      const byStatus = JSON.parse(
        (await callTool(client, 'list_tasks', { projectId: project.id, status: 'in_progress' }))
          .text,
      );
      expect(byStatus.map((t: { id: string }) => t.id)).toEqual([started.id]);
    });
  });

  it('confirm_task_reassessment:needs_reassessment 回 pending,其他状态 isError', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求' },
        'human',
      );
      const point = await seedPoint(db, req.id, '点');
      const task = await core.tasks.createTask(
        { requirementPointId: point.id, title: '要重估的任务' },
        'human',
      );
      const { client } = await setupServer(db);

      // 非 needs_reassessment 状态先拒
      const bad = await callTool(client, 'confirm_task_reassessment', { id: task.id });
      expect(bad.isError).toBe(true);
      expect(bad.text).toContain('INVALID_STATUS_TRANSITION');

      // 经点实质修改联动出 needs_reassessment
      await core.points.updateRequirementPoint(point.id, { title: '点改题' }, 'human');
      const ok = await callTool(client, 'confirm_task_reassessment', { id: task.id });
      expect(ok.isError).toBe(false);
      expect(JSON.parse(ok.text)).toMatchObject({ status: 'pending' });
    });
  });
});
