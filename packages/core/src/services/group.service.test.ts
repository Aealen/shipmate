import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import { changeLogs, groups, projects } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { GroupService } from './group.service.js';

async function seedProject(db: ShipmateDb, groupId: string): Promise<string> {
  const now = Date.now();
  const rows = await db
    .insert(projects)
    .values({ id: newId(), groupId, name: 'P', status: 'active', createdAt: now, updatedAt: now })
    .returning();
  return rows[0]!.id;
}

describe('GroupService', () => {
  it('createGroup:落库 + create 变更记录', async () => {
    await withDb(async (db) => {
      const svc = new GroupService(db);
      const g = await svc.createGroup({ name: '华信事业部' }, 'human');
      expect(g.name).toBe('华信事业部');
      expect(g.sortOrder).toBe(0);
      const log = await db.select().from(changeLogs).where(eq(changeLogs.entityId, g.id));
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        entityType: 'group',
        changeType: 'create',
        actor: 'human',
        beforeSnapshot: null,
      });
    });
  });

  it('createGroup:name 为空抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const svc = new GroupService(db);
      try {
        await svc.createGroup({ name: '' }, 'human');
        expect.unreachable('应当抛错');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  it('updateGroup:部分字段更新 + before/after 快照', async () => {
    await withDb(async (db) => {
      const svc = new GroupService(db);
      const g = await svc.createGroup({ name: '旧名' }, 'human');
      const after = await svc.updateGroup(g.id, { name: '新名', sortOrder: 5 }, 'human');
      expect(after).toMatchObject({ name: '新名', sortOrder: 5, description: null });
      // 按 entityId 收窄:共享真实库中存在其他 update 日志
      const log = await db
        .select()
        .from(changeLogs)
        .where(and(eq(changeLogs.changeType, 'update'), eq(changeLogs.entityId, g.id)));
      expect(log).toHaveLength(1);
      expect(log[0]?.beforeSnapshot).toMatchObject({ name: '旧名', sortOrder: 0 });
    });
  });

  it('deleteGroup:组内有项目抛 GROUP_NOT_EMPTY,空组可删并记 delete', async () => {
    await withDb(async (db) => {
      const svc = new GroupService(db);
      const g = await svc.createGroup({ name: '有项目的组' }, 'human');
      await seedProject(db, g.id);
      try {
        await svc.deleteGroup(g.id, 'human');
        expect.unreachable('应当抛 GROUP_NOT_EMPTY');
      } catch (e) {
        expect((e as DomainError).code).toBe('GROUP_NOT_EMPTY');
      }

      const empty = await svc.createGroup({ name: '空组' }, 'human');
      await expect(svc.deleteGroup(empty.id, 'human')).resolves.toBeUndefined();
      expect(await db.select().from(groups).where(eq(groups.id, empty.id))).toHaveLength(0);
      // 按 entityId 收窄:共享真实库中可能存在其他 delete 日志
      const log = await db
        .select()
        .from(changeLogs)
        .where(and(eq(changeLogs.changeType, 'delete'), eq(changeLogs.entityId, empty.id)));
      expect(log).toHaveLength(1);
      expect(log[0]?.entityType).toBe('group');
    });
  });

  it('getGroup:返回分组 + 组内项目完成度;不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = new GroupService(db);
      const g = await svc.createGroup({ name: 'G' }, 'human');
      await seedProject(db, g.id);
      const summary = await svc.getGroup(g.id);
      expect(summary.group.name).toBe('G');
      expect(summary.projects).toHaveLength(1);
      expect(summary.projects[0]).toMatchObject({ requirementTotal: 0, requirementDone: 0 });

      try {
        await svc.getGroup('missing');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('listGroups:含各组项目数', async () => {
    await withDb(async (db) => {
      const svc = new GroupService(db);
      const before = (await svc.listGroups()).length;
      const g1 = await svc.createGroup({ name: 'G1' }, 'human');
      const g2 = await svc.createGroup({ name: 'G2' }, 'human');
      const rows = await svc.listGroups();
      // 共享真实库:总列表用相对计数 diff
      expect(rows.length - before).toBe(2);
      // projectCount 仅对本用例自建的空组断言(真实组可能已有项目)
      const mine = rows.filter((r) => r.id === g1.id || r.id === g2.id);
      expect(mine).toHaveLength(2);
      expect(mine.every((r) => r.projectCount === 0)).toBe(true);
    });
  });
});
