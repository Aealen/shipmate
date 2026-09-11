import { describe, expect, it } from 'vitest';
import { createCore, withDb } from '@shipmate/core';
import { callTool, setupServer, TEST_ACTOR } from '../test-helpers.js';

const DAY = 86_400_000;

describe('需求工具', () => {
  it('tools/list 注册了全部需求工具', async () => {
    await withDb(async (db) => {
      const { client } = await setupServer(db);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const name of ['create_requirement', 'update_requirement', 'list_requirements']) {
        expect(names).toContain(name);
      }
    });
  });

  it('create_requirement 落库默认 draft/P2,审计 actor 为注入值', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'create_requirement', {
        projectId: project.id,
        title: '登录功能',
        summary: '支持手机号登录',
        planDueAt: Date.now() + DAY,
      });
      expect(isError).toBe(false);
      const created = JSON.parse(text);
      expect(created).toMatchObject({
        projectId: project.id,
        title: '登录功能',
        status: 'draft',
        priority: 'P2',
      });
      const logs = await core.audit.getChangeLog({
        entityType: 'requirement',
        entityId: created.id,
      });
      expect(logs[0]).toMatchObject({ actor: TEST_ACTOR, changeType: 'create' });
    });
  });

  it('update_requirement 改状态记 status_change;非法优先级 isError', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求' },
        'human',
      );
      const { client } = await setupServer(db);

      const updated = await callTool(client, 'update_requirement', {
        id: req.id,
        status: 'confirmed',
        priority: 'P0',
      });
      expect(updated.isError).toBe(false);
      expect(JSON.parse(updated.text)).toMatchObject({ status: 'confirmed', priority: 'P0' });
      const logs = await core.audit.getChangeLog({
        entityType: 'requirement',
        entityId: req.id,
      });
      expect(logs[0]).toMatchObject({ actor: TEST_ACTOR, changeType: 'status_change' });

      const bad = await callTool(client, 'update_requirement', {
        id: req.id,
        priority: 'P9',
      });
      expect(bad.isError).toBe(true);
    });
  });

  it('list_requirements 返回 overdue/overdueDays/dueSoon 计算字段并支持过滤', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      await core.requirements.createRequirement(
        { projectId: project.id, title: '已超期', planDueAt: Date.now() - 2 * DAY },
        'human',
      );
      const dueSoon = await core.requirements.createRequirement(
        { projectId: project.id, title: '临期', planDueAt: Date.now() + DAY },
        'human',
      );
      const done = await core.requirements.createRequirement(
        { projectId: project.id, title: '已完成' },
        'human',
      );
      await core.requirements.updateRequirement(done.id, { status: 'done' }, 'human');
      const { client } = await setupServer(db);

      const all = JSON.parse(
        (await callTool(client, 'list_requirements', { projectId: project.id })).text,
      );
      expect(all).toHaveLength(3);
      const overdueRow = all.find((r: { title: string }) => r.title === '已超期');
      expect(overdueRow).toMatchObject({ overdue: true });
      expect(overdueRow.overdueDays).toBeGreaterThanOrEqual(2);
      expect(all.find((r: { title: string }) => r.title === '临期')).toMatchObject({
        overdue: false,
        dueSoon: true,
      });
      expect(all.find((r: { title: string }) => r.title === '已完成')).toMatchObject({
        overdue: false,
        dueSoon: false,
      });
      void dueSoon;

      // overdue 过滤:只留超期
      const onlyOverdue = JSON.parse(
        (await callTool(client, 'list_requirements', { projectId: project.id, overdue: true }))
          .text,
      );
      expect(onlyOverdue.map((r: { title: string }) => r.title)).toEqual(['已超期']);

      // status 过滤
      const onlyDone = JSON.parse(
        (await callTool(client, 'list_requirements', { projectId: project.id, status: 'done' }))
          .text,
      );
      expect(onlyDone.map((r: { title: string }) => r.title)).toEqual(['已完成']);
    });
  });

  it('create_requirement 项目不存在返回 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const { client } = await setupServer(db);
      const { isError, text } = await callTool(client, 'create_requirement', {
        projectId: 'ghost',
        title: '孤儿需求',
      });
      expect(isError).toBe(true);
      expect(text).toContain('NOT_FOUND');
    });
  });
});
