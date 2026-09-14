import { describe, expect, it } from 'vitest';
import { createCore, newId, requirementPoints, withDb } from '@shipmate/core';
import { callTool, setupServer, TEST_ACTOR } from '../test-helpers.js';

/** 4 个工具名(tools/list 断言用,防漏注册) */
const ALL_TOOLS = ['create_module', 'update_module', 'delete_module', 'list_modules'];

describe('模块工具', () => {
  it('tools/list 注册了全部模块工具', async () => {
    await withDb(async (db) => {
      const { client } = await setupServer(db);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const name of ALL_TOOLS) expect(names).toContain(name);
      // 中文 description(给 agent 的语义提示)
      const createModule = tools.find((t) => t.name === 'create_module')!;
      expect(createModule.description).toContain('模块');
    });
  });

  it('create_module 落库并以注入 actor 记审计;同项目重名 MODULE_NAME_TAKEN', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '模块项目' }, 'human');
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'create_module', {
        projectId: project.id,
        name: '文档解析',
        description: 'PDF/Word 解析',
      });
      expect(isError).toBe(false);
      const created = JSON.parse(text);
      expect(created).toMatchObject({
        projectId: project.id,
        name: '文档解析',
        sortOrder: 0,
      });
      const logs = await core.audit.getChangeLog({ entityType: 'module', entityId: created.id });
      expect(logs[0]).toMatchObject({
        actor: TEST_ACTOR,
        entityType: 'module',
        changeType: 'create',
      });

      // 同项目重名拒绝
      const dup = await callTool(client, 'create_module', {
        projectId: project.id,
        name: '文档解析',
      });
      expect(dup.isError).toBe(true);
      expect(dup.text).toContain('MODULE_NAME_TAKEN');

      // 不同项目同名允许
      const other = await core.projects.createProject({ name: '其他项目' }, 'human');
      const ok = await callTool(client, 'create_module', { projectId: other.id, name: '文档解析' });
      expect(ok.isError).toBe(false);
    });
  });

  it('update_module 改名与排序,记 update 审计;不存在 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '改名项目' }, 'human');
      const created = await core.modules.createModule(
        { projectId: project.id, name: '旧名' },
        'human',
      );
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'update_module', {
        id: created.id,
        name: '新名',
        sortOrder: 5,
      });
      expect(isError).toBe(false);
      expect(JSON.parse(text)).toMatchObject({ name: '新名', sortOrder: 5 });
      const logs = await core.audit.getChangeLog({ entityType: 'module', entityId: created.id });
      expect(logs[0]).toMatchObject({ actor: TEST_ACTOR, changeType: 'update' });

      const ghost = await callTool(client, 'update_module', { id: 'ghost', name: 'x' });
      expect(ghost.isError).toBe(true);
      expect(ghost.text).toContain('NOT_FOUND');
    });
  });

  it('delete_module 删除后其下需求转未归类,delete 快照留存;不存在 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '删除项目' }, 'human');
      const created = await core.modules.createModule(
        { projectId: project.id, name: '待删模块' },
        'human',
      );
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '挂模块需求', moduleId: created.id },
        'human',
      );
      const { client } = await setupServer(db);

      const { isError } = await callTool(client, 'delete_module', { id: created.id });
      expect(isError).toBe(false);
      // 需求仍在且转未归类
      const untagged = await core.requirements.listRequirements(project.id, { moduleId: null });
      expect(untagged.map((r) => r.id)).toContain(req.id);
      // 模块已消失
      expect(await core.modules.listModules(project.id)).toHaveLength(0);
      // delete 快照留痕
      const logs = await core.audit.getChangeLog({ entityType: 'module', entityId: created.id });
      expect(logs[0]).toMatchObject({ actor: TEST_ACTOR, changeType: 'delete' });

      const ghost = await callTool(client, 'delete_module', { id: 'ghost' });
      expect(ghost.isError).toBe(true);
      expect(ghost.text).toContain('NOT_FOUND');
    });
  });

  it('list_modules 返回需求数与需求点就绪统计', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '统计项目' }, 'human');
      const created = await core.modules.createModule(
        { projectId: project.id, name: '统计模块' },
        'human',
      );
      const r1 = await core.requirements.createRequirement(
        { projectId: project.id, title: 'R1', moduleId: created.id },
        'human',
      );
      await core.requirements.createRequirement(
        { projectId: project.id, title: 'R2', moduleId: created.id },
        'human',
      );
      // r1 挂 2 个点:1 done 1 draft
      const now = Date.now();
      await db.insert(requirementPoints).values([
        {
          id: newId(),
          requirementId: r1.id,
          title: 'P1',
          status: 'done',
          version: 1,
          origin: 'manual',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: newId(),
          requirementId: r1.id,
          title: 'P2',
          status: 'draft',
          version: 1,
          origin: 'manual',
          createdAt: now,
          updatedAt: now,
        },
      ]);
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'list_modules', {
        projectId: project.id,
      });
      expect(isError).toBe(false);
      const list = JSON.parse(text);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: created.id,
        name: '统计模块',
        requirementCount: 2,
        pointsDone: 1,
        pointsTotal: 2,
      });
    });
  });

  it('需求工具 moduleId 透传:undefined 不变、null 转未归类、过滤生效', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '归类项目' }, 'human');
      const moduleA = await core.modules.createModule(
        { projectId: project.id, name: '模块A' },
        'human',
      );
      const moduleB = await core.modules.createModule(
        { projectId: project.id, name: '模块B' },
        'human',
      );
      const { client } = await setupServer(db);

      // create_requirement 带 moduleId 落库
      const created = await callTool(client, 'create_requirement', {
        projectId: project.id,
        title: '入模需求',
        moduleId: moduleA.id,
      });
      expect(created.isError).toBe(false);
      const req = JSON.parse(created.text);
      expect(req).toMatchObject({ moduleId: moduleA.id });

      // create_requirement 不带 moduleId → 未归类
      const plain = await callTool(client, 'create_requirement', {
        projectId: project.id,
        title: '未归类需求',
      });
      expect(JSON.parse(plain.text)).toMatchObject({ moduleId: null });

      // update_requirement 换绑模块
      const moved = await callTool(client, 'update_requirement', {
        id: req.id,
        moduleId: moduleB.id,
      });
      expect(moved.isError).toBe(false);
      expect(JSON.parse(moved.text)).toMatchObject({ moduleId: moduleB.id });

      // update_requirement 不传 moduleId → 模块保持不变
      const untouched = await callTool(client, 'update_requirement', {
        id: req.id,
        title: '只改标题',
      });
      expect(JSON.parse(untouched.text)).toMatchObject({ title: '只改标题', moduleId: moduleB.id });

      // update_requirement 显式 null → 转未归类
      const untagged = await callTool(client, 'update_requirement', {
        id: req.id,
        moduleId: null,
      });
      expect(untagged.isError).toBe(false);
      expect(JSON.parse(untagged.text)).toMatchObject({ moduleId: null });

      // list_requirements 按 moduleId 过滤(新项目隔离,无历史数据干扰)
      await callTool(client, 'create_requirement', {
        projectId: project.id,
        title: 'A组需求',
        moduleId: moduleA.id,
      });
      const inA = JSON.parse(
        (await callTool(client, 'list_requirements', { projectId: project.id, moduleId: moduleA.id }))
          .text,
      );
      expect(inA.map((r: { title: string }) => r.title)).toEqual(['A组需求']);
      // moduleId=null 仅未归类
      const untaggedList = JSON.parse(
        (await callTool(client, 'list_requirements', { projectId: project.id, moduleId: null }))
          .text,
      );
      const titles = untaggedList.map((r: { title: string }) => r.title);
      expect(titles).toContain('未归类需求');
      expect(titles).toContain('只改标题');
      expect(titles).not.toContain('A组需求');
    });
  });
});
