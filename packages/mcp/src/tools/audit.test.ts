import { describe, expect, it } from 'vitest';
import { createCore, withDb } from '@shipmate/core';
import { callTool, setupServer } from '../test-helpers.js';

describe('审计与进度工具', () => {
  it('tools/list 注册了全部审计与进度工具', async () => {
    await withDb(async (db) => {
      const { client } = await setupServer(db);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const name of ['get_change_log', 'get_project_audit_report', 'get_project_progress']) {
        expect(names).toContain(name);
      }
    });
  });

  it('get_change_log 按实体类型与 id 查时间线,limit 生效', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const group = await core.groups.createGroup({ name: '审计组' }, 'human');
      await core.groups.updateGroup(group.id, { name: '审计组二' }, 'human');
      await core.groups.updateGroup(group.id, { sortOrder: 5 }, 'human');
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'get_change_log', {
        entityType: 'group',
        entityId: group.id,
      });
      expect(isError).toBe(false);
      const logs = JSON.parse(text);
      expect(logs.length).toBeGreaterThanOrEqual(3);
      // 时间线按 createdAt 倒序
      expect(logs[0].changeType).toBe('update');

      const limited = JSON.parse(
        (
          await callTool(client, 'get_change_log', {
            entityType: 'group',
            entityId: group.id,
            limit: 1,
          })
        ).text,
      );
      expect(limited).toHaveLength(1);
    });
  });

  it('get_project_audit_report 返回时间线、actor 分布、实体分布与每日计数', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '审计项目' }, 'human');
      const req = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求' },
        'human',
      );
      // MCP actor 的写操作 → actorDistribution.mcp 增加
      const { client } = await setupServer(db);
      await callTool(client, 'update_requirement', { id: req.id, priority: 'P0' });

      const { isError, text } = await callTool(client, 'get_project_audit_report', {
        projectId: project.id,
      });
      expect(isError).toBe(false);
      const report = JSON.parse(text);
      expect(report.timeline.length).toBeGreaterThanOrEqual(3);
      expect(report.actorDistribution).toMatchObject({ mcp: 1 });
      expect(report.entityTypeDistribution).toMatchObject({ project: 1, requirement: 2 });
      expect(report.dailyCounts.length).toBeGreaterThan(0);
      expect(report.dailyCounts[0]).toMatchObject({ count: expect.any(Number) });
    });
  });

  it('get_project_progress 返回项目概要进度', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '进度项目' }, 'human');
      const req1 = await core.requirements.createRequirement(
        { projectId: project.id, title: '需求一' },
        'human',
      );
      await core.requirements.createRequirement(
        { projectId: project.id, title: '需求二', planDueAt: Date.now() - 86_400_000 },
        'human',
      );
      await core.requirements.updateRequirement(req1.id, { status: 'done' }, 'human');
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'get_project_progress', {
        projectId: project.id,
      });
      expect(isError).toBe(false);
      const summary = JSON.parse(text);
      expect(summary.project).toMatchObject({ id: project.id, name: '进度项目' });
      expect(summary).toMatchObject({
        requirementTotal: 2,
        requirementDone: 1,
        overdueRequirementCount: 1,
        pointStatusCounts: { draft: 0, confirmed: 0, developing: 0, done: 0 },
      });
      expect(Array.isArray(summary.recentChanges)).toBe(true);
    });
  });

  it('get_project_audit_report 项目不存在返回 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const { client } = await setupServer(db);
      const { isError, text } = await callTool(client, 'get_project_audit_report', {
        projectId: 'ghost',
      });
      expect(isError).toBe(true);
      expect(text).toContain('NOT_FOUND');
    });
  });
});
