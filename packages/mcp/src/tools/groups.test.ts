import { describe, expect, it } from 'vitest';
import { createCore, withDb } from '@shipmate/core';
import { callTool, setupServer, TEST_ACTOR } from '../test-helpers.js';

/** 9 个工具名(tools/list 断言用,防漏注册) */
const ALL_TOOLS = [
  'create_group',
  'update_group',
  'delete_group',
  'list_groups',
  'get_group',
  'create_project',
  'update_project',
  'list_projects',
  'get_project',
];

describe('分组与项目工具', () => {
  it('tools/list 注册了全部分组与项目工具', async () => {
    await withDb(async (db) => {
      const { client } = await setupServer(db);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const name of ALL_TOOLS) expect(names).toContain(name);
      // 中文 description(给 agent 的语义提示)
      const createGroup = tools.find((t) => t.name === 'create_group')!;
      expect(createGroup.description).toContain('分组');
    });
  });

  it('create_group 落库并以注入 actor 记审计', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const { client } = await setupServer(db);
      const { isError, text } = await callTool(client, 'create_group', { name: '交付一组' });
      expect(isError).toBe(false);
      const created = JSON.parse(text);
      expect(created).toMatchObject({ name: '交付一组', sortOrder: 0 });
      const fetched = await core.groups.getGroup(created.id);
      expect(fetched.group.name).toBe('交付一组');
      const logs = await core.audit.getChangeLog({ entityType: 'group', entityId: created.id });
      expect(logs[0]).toMatchObject({
        actor: TEST_ACTOR,
        entityType: 'group',
        changeType: 'create',
      });
    });
  });

  it('update_group 改名与排序,list_groups 带项目计数', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const { client } = await setupServer(db);
      const group = await core.groups.createGroup({ name: '旧名' }, 'human');
      await core.projects.createProject({ name: '项目P', groupId: group.id }, 'human');

      const updated = await callTool(client, 'update_group', {
        id: group.id,
        name: '新名',
        sortOrder: 7,
      });
      expect(updated.isError).toBe(false);
      expect(JSON.parse(updated.text)).toMatchObject({ name: '新名', sortOrder: 7 });

      const list = await callTool(client, 'list_groups');
      const groups = JSON.parse(list.text);
      const row = groups.find((g: { id: string }) => g.id === group.id);
      expect(row).toMatchObject({ name: '新名', projectCount: 1 });
      expect(row.projectCount).toBe(1);
    });
  });

  it('get_group 返回组内项目与需求完成度', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const { client } = await setupServer(db);
      const group = await core.groups.createGroup({ name: '组G' }, 'human');
      const project = await core.projects.createProject(
        { name: '项目X', groupId: group.id },
        'human',
      );
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求R' },
        'human',
      );
      await core.requirements.updateRequirement(req.id, { status: 'done' }, 'human');

      const { isError, text } = await callTool(client, 'get_group', { id: group.id });
      expect(isError).toBe(false);
      const summary = JSON.parse(text);
      expect(summary.group).toMatchObject({ id: group.id, name: '组G' });
      expect(summary.projects).toHaveLength(1);
      expect(summary.projects[0]).toMatchObject({
        requirementTotal: 1,
        requirementDone: 1,
        project: { id: project.id },
      });
    });
  });

  it('delete_group 组内非空返回 isError 含 GROUP_NOT_EMPTY,且组未被删除', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const { client } = await setupServer(db);
      const group = await core.groups.createGroup({ name: '不能删' }, 'human');
      await core.projects.createProject({ name: '占用项目', groupId: group.id }, 'human');

      const { isError, text } = await callTool(client, 'delete_group', { id: group.id });
      expect(isError).toBe(true);
      expect(text).toContain('GROUP_NOT_EMPTY');
      // 组仍在
      const summary = await core.groups.getGroup(group.id);
      expect(summary.group.name).toBe('不能删');
    });
  });

  it('delete_group 空组删除成功', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const { client } = await setupServer(db);
      const group = await core.groups.createGroup({ name: '空组' }, 'human');
      const { isError } = await callTool(client, 'delete_group', { id: group.id });
      expect(isError).toBe(false);
      await expect(core.groups.getGroup(group.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('create_project/update_project/get_project 全链路,归档记 status_change 审计', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const { client } = await setupServer(db);
      const group = await core.groups.createGroup({ name: '归属组' }, 'human');

      const created = await callTool(client, 'create_project', {
        groupId: group.id,
        name: '新项目',
        description: '说明',
      });
      expect(created.isError).toBe(false);
      const project = JSON.parse(created.text);
      expect(project).toMatchObject({ name: '新项目', status: 'active', groupId: group.id });

      const updated = await callTool(client, 'update_project', {
        id: project.id,
        status: 'archived',
      });
      expect(updated.isError).toBe(false);
      expect(JSON.parse(updated.text)).toMatchObject({ status: 'archived' });
      const logs = await core.audit.getChangeLog({
        entityType: 'project',
        entityId: project.id,
      });
      expect(logs[0]).toMatchObject({ actor: TEST_ACTOR, changeType: 'status_change' });

      const got = await callTool(client, 'get_project', { id: project.id });
      expect(got.isError).toBe(false);
      const summary = JSON.parse(got.text);
      expect(summary.project).toMatchObject({ id: project.id, status: 'archived' });
      expect(summary).toMatchObject({
        requirementTotal: 0,
        requirementDone: 0,
        overdueRequirementCount: 0,
        pointStatusCounts: { draft: 0, confirmed: 0, developing: 0, done: 0 },
      });
      expect(Array.isArray(summary.recentChanges)).toBe(true);
    });
  });

  it('list_projects 支持 groupId 过滤与 null(仅无分组项目)', async () => {
    await withDb(async (db) => {
      const { client } = await setupServer(db);
      const group = await createCore(db).groups.createGroup({ name: '过滤组' }, 'human');
      await callTool(client, 'create_project', { groupId: group.id, name: '组内项目' });
      await callTool(client, 'create_project', { name: '散养项目' });

      // 测试库可能存在历史已提交数据,全表断言用相对过滤,不假设空表
      const all = JSON.parse((await callTool(client, 'list_projects')).text);
      expect(
        all.filter((p: { name: string }) => p.name === '组内项目' || p.name === '散养项目'),
      ).toHaveLength(2);
      const inGroup = JSON.parse(
        (await callTool(client, 'list_projects', { groupId: group.id })).text,
      );
      expect(inGroup.map((p: { name: string }) => p.name)).toEqual(['组内项目']);
      const orphan = JSON.parse((await callTool(client, 'list_projects', { groupId: null })).text);
      const orphanNames = orphan.map((p: { name: string }) => p.name);
      expect(orphanNames).toContain('散养项目');
      expect(orphanNames).not.toContain('组内项目');
    });
  });

  it('get_project 不存在返回 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const { client } = await setupServer(db);
      const { isError, text } = await callTool(client, 'get_project', { id: 'ghost' });
      expect(isError).toBe(true);
      expect(text).toContain('NOT_FOUND');
    });
  });
});
