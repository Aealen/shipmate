import { describe, expect, it } from 'vitest';
import {
  createCore,
  newId,
  requirementPoints,
  withDb,
  writeChangeLog,
  type RequirementPointRow,
  type ShipmateTx,
} from '@shipmate/core';
import { callTool, setupServer } from '../test-helpers.js';

/** 造需求点:core 无独立 createPoint(点来自分析/manual),测试直接落一行并补 create 审计 */
async function seedPoint(
  db: Parameters<Parameters<typeof withDb>[0]>[0],
  requirementId: string,
  title: string,
  status: RequirementPointRow['status'] = 'draft',
): Promise<RequirementPointRow> {
  const now = Date.now();
  const row = (
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
  await writeChangeLog(db as unknown as ShipmateTx, {
    entityType: 'requirement_point',
    entityId: row.id,
    changeType: 'create',
    after: row,
    actor: 'human',
  });
  return row;
}

describe('需求点工具', () => {
  it('tools/list 注册了全部需求点工具', async () => {
    await withDb(async (db) => {
      const { client } = await setupServer(db);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const name of [
        'list_requirement_points',
        'get_requirement_point',
        'update_requirement_point',
        'set_requirement_point_status',
        'confirm_requirement_point',
      ]) {
        expect(names).toContain(name);
      }
    });
  });

  it('list_requirement_points 按 requirementId/projectId/status 过滤', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const req1 = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求一' },
        'human',
      );
      const req2 = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求二' },
        'human',
      );
      await seedPoint(db, req1.id, '点A');
      await seedPoint(db, req1.id, '点B', 'confirmed');
      await seedPoint(db, req2.id, '点C');
      const { client } = await setupServer(db);

      const byReq = JSON.parse(
        (await callTool(client, 'list_requirement_points', { requirementId: req1.id })).text,
      );
      expect(byReq.map((p: { title: string }) => p.title).sort()).toEqual(['点A', '点B']);

      const byProject = JSON.parse(
        (await callTool(client, 'list_requirement_points', { projectId: project.id })).text,
      );
      expect(byProject).toHaveLength(3);

      const confirmed = JSON.parse(
        (
          await callTool(client, 'list_requirement_points', {
            projectId: project.id,
            status: 'confirmed',
          })
        ).text,
      );
      expect(confirmed.map((p: { title: string }) => p.title)).toEqual(['点B']);
    });
  });

  it('get_requirement_point 返回点 + 任务 + 变更历史', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求' },
        'human',
      );
      const point = await seedPoint(db, req.id, '被查点');
      const task = await core.tasks.createTask(
        { requirementPointId: point.id, title: '任务一' },
        'human',
      );
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'get_requirement_point', {
        id: point.id,
      });
      expect(isError).toBe(false);
      const detail = JSON.parse(text);
      expect(detail.point).toMatchObject({ id: point.id, title: '被查点' });
      expect(detail.tasks.map((t: { id: string }) => t.id)).toEqual([task.id]);
      expect(detail.changeLogs.length).toBeGreaterThan(0);
    });
  });

  it('update_requirement_point 实质修改回退状态、联动任务待重估并返回 affectedTaskCount', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求' },
        'human',
      );
      // developing 点 + 其下任务,实质修改后:点回退 confirmed、任务 needs_reassessment
      const point = await seedPoint(db, req.id, '原题', 'developing');
      await core.tasks.createTask({ requirementPointId: point.id, title: '任务一' }, 'human');
      await core.tasks.createTask({ requirementPointId: point.id, title: '任务二' }, 'human');
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'update_requirement_point', {
        id: point.id,
        title: '改后的题',
        reason: '客户补充了口径',
      });
      expect(isError).toBe(false);
      const result = JSON.parse(text);
      expect(result.point).toMatchObject({ title: '改后的题', status: 'confirmed', version: 2 });
      expect(result.affectedTaskCount).toBe(2);

      const detail = await core.points.getRequirementPoint(point.id);
      expect(detail.tasks.map((t) => t.status)).toEqual([
        'needs_reassessment',
        'needs_reassessment',
      ]);
    });
  });

  it('set_requirement_point_status 合法流转成功,非法流转 isError 含 INVALID_STATUS_TRANSITION', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求' },
        'human',
      );
      const point = await seedPoint(db, req.id, '流转点');
      const { client } = await setupServer(db);

      // draft → start 非法
      const bad = await callTool(client, 'set_requirement_point_status', {
        id: point.id,
        action: 'start',
      });
      expect(bad.isError).toBe(true);
      expect(bad.text).toContain('INVALID_STATUS_TRANSITION');

      // draft → confirm 合法
      const ok = await callTool(client, 'set_requirement_point_status', {
        id: point.id,
        action: 'confirm',
      });
      expect(ok.isError).toBe(false);
      expect(JSON.parse(ok.text)).toMatchObject({ status: 'confirmed' });
    });
  });

  it('confirm_requirement_point 语义化别名等同 confirm', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求' },
        'human',
      );
      const point = await seedPoint(db, req.id, '别名点');
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'confirm_requirement_point', {
        id: point.id,
      });
      expect(isError).toBe(false);
      expect(JSON.parse(text)).toMatchObject({ status: 'confirmed' });
    });
  });
});
