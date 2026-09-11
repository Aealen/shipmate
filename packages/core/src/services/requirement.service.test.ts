import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { withDb } from '../db/database.js';
import { changeLogs, projects, type RequirementRow } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import {
  computeOverdue,
  RequirementService,
  type RequirementWithOverdue,
} from './requirement.service.js';

const DAY = 86_400_000;

function baseReq(): RequirementRow {
  return {
    id: 'r',
    projectId: 'p',
    title: 'R',
    summary: null,
    priority: 'P2',
    planStartAt: null,
    planDueAt: null,
    completedAt: null,
    status: 'confirmed',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('computeOverdue', () => {
  it('超期:draft/confirmed 且 planDueAt 已过 → overdue + 天数', () => {
    const now = Date.now();
    expect(
      computeOverdue({ ...baseReq(), status: 'confirmed', planDueAt: now - 3.5 * DAY }, now),
    ).toEqual({ overdue: true, overdueDays: 3, dueSoon: false });
    expect(
      computeOverdue({ ...baseReq(), status: 'draft', planDueAt: now - 1 * DAY }, now),
    ).toEqual({ overdue: true, overdueDays: 1, dueSoon: false });
  });

  it('未超期但 ≤3 天 → dueSoon', () => {
    const now = Date.now();
    expect(
      computeOverdue({ ...baseReq(), status: 'confirmed', planDueAt: now + 2 * DAY }, now),
    ).toEqual({ overdue: false, overdueDays: 0, dueSoon: true });
    expect(
      computeOverdue({ ...baseReq(), status: 'confirmed', planDueAt: now + 4 * DAY }, now),
    ).toEqual({ overdue: false, overdueDays: 0, dueSoon: false });
  });

  it('done/archived 不参与;未设 planDueAt 不参与', () => {
    const now = Date.now();
    expect(
      computeOverdue({ ...baseReq(), status: 'done', planDueAt: now - 10 * DAY }, now).overdue,
    ).toBe(false);
    expect(computeOverdue({ ...baseReq(), status: 'confirmed', planDueAt: null }, now)).toEqual({
      overdue: false,
      overdueDays: 0,
      dueSoon: false,
    });
  });
});

describe('RequirementService', () => {
  it('createRequirement:默认 P2/draft;projectId 不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = new RequirementService(db);
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const r = await svc.createRequirement(
        { projectId: p.id, title: '导出功能', priority: 'P0', planDueAt: Date.now() + 1000 },
        'human',
      );
      expect(r).toMatchObject({ status: 'draft', priority: 'P0', completedAt: null });
      try {
        await svc.createRequirement({ projectId: 'missing', title: 'x' }, 'human');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('updateRequirement:进 done 写 completedAt 并记 status_change;离开 done 清空', async () => {
    await withDb(async (db) => {
      const svc = new RequirementService(db);
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const r = await svc.createRequirement({ projectId: p.id, title: 'A' }, 'human');
      const done = await svc.updateRequirement(r.id, { status: 'done' }, 'human');
      expect(done.completedAt).not.toBeNull();
      expect(
        await db.select().from(changeLogs).where(eq(changeLogs.changeType, 'status_change')),
      ).toHaveLength(1);

      const reopened = await svc.updateRequirement(r.id, { status: 'confirmed' }, 'human');
      expect(reopened.completedAt).toBeNull();
    });
  });

  it('updateRequirement:title 变更记 update,不动 completedAt', async () => {
    await withDb(async (db) => {
      const svc = new RequirementService(db);
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const r = await svc.createRequirement({ projectId: p.id, title: '旧' }, 'human');
      await svc.updateRequirement(r.id, { title: '新' }, 'human');
      const logs = await db.select().from(changeLogs).where(eq(changeLogs.changeType, 'update'));
      expect(logs).toHaveLength(1);
      expect(logs[0]?.beforeSnapshot).toMatchObject({ title: '旧' });
    });
  });

  it('listRequirements:overdue=true 过滤只留超期项,并带计算字段', async () => {
    await withDb(async (db) => {
      const svc = new RequirementService(db);
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      await svc.createRequirement(
        { projectId: p.id, title: '已超期', planDueAt: now - 5 * DAY },
        'human',
      );
      await svc.createRequirement(
        { projectId: p.id, title: '临期', planDueAt: now + 2 * DAY },
        'human',
      );
      await svc.createRequirement(
        { projectId: p.id, title: '远期', planDueAt: now + 30 * DAY },
        'human',
      );
      await svc.createRequirement({ projectId: p.id, title: '无期限' }, 'human');

      const all = await svc.listRequirements(p.id);
      expect(all).toHaveLength(4);
      expect(all.every((r: RequirementWithOverdue) => typeof r.overdue === 'boolean')).toBe(true);

      const overdue = await svc.listRequirements(p.id, { overdue: true });
      expect(overdue.map((r) => r.title)).toEqual(['已超期']);
      expect(overdue[0]?.overdueDays).toBe(5);
    });
  });
});
