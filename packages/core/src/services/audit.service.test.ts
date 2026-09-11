import { describe, expect, it } from 'vitest';
import { withDb } from '../db/database.js';
import { projects } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { GroupService } from './group.service.js';
import { ProjectService } from './project.service.js';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  it('getProjectAuditReport:时间线 + actor 分布 + 类型分布 + 日计数', async () => {
    await withDb(async (db) => {
      const groups = new GroupService(db);
      const projectsSvc = new ProjectService(db);
      const audit = new AuditService(db);
      const g = await groups.createGroup({ name: 'G' }, 'human');
      const p = await projectsSvc.createProject({ groupId: g.id, name: '项目' }, 'human');
      await projectsSvc.updateProject(p.id, { name: '项目改名' }, 'mcp:claude-code');
      await projectsSvc.updateProject(p.id, { status: 'archived' }, 'human');

      const report = await audit.getProjectAuditReport(p.id);
      expect(report.timeline.length).toBeGreaterThanOrEqual(3); // create + update + status_change
      expect(report.actorDistribution).toMatchObject({ human: 2, mcp: 1 });
      expect(report.entityTypeDistribution['project']).toBeGreaterThanOrEqual(3);
      expect(report.dailyCounts.length).toBeGreaterThanOrEqual(1);
      expect(report.dailyCounts[0]).toMatchObject({ count: report.timeline.length });
    });
  });

  it('getProjectAuditReport:项目不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const audit = new AuditService(db);
      try {
        await audit.getProjectAuditReport('missing');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('getChangeLog:limit 与倒序', async () => {
    await withDb(async (db) => {
      const audit = new AuditService(db);
      const projectsSvc = new ProjectService(db);
      const p = await projectsSvc.createProject({ name: 'P' }, 'human');
      for (let i = 0; i < 5; i++) await projectsSvc.updateProject(p.id, { name: `名字${i}` }, 'human');

      const rows = await audit.getChangeLog({ entityType: 'project', entityId: p.id, limit: 3 });
      expect(rows).toHaveLength(3);
      expect(rows[0]!.createdAt).toBeGreaterThanOrEqual(rows[2]!.createdAt);
    });
  });
});
