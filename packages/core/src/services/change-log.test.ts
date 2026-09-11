import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { withDb } from '../db/database.js';
import { changeLogs } from '../db/schema.js';
import { writeChangeLog } from './change-log.js';

describe('writeChangeLog', () => {
  it('在事务内写入,缺省 before/reason 为 null', async () => {
    await withDb(async (db) => {
      await db.transaction(async (tx) => {
        await writeChangeLog(tx, {
          entityType: 'project',
          entityId: 'p1',
          changeType: 'create',
          after: { id: 'p1', name: '项目一' },
          actor: 'human',
        });
      });
      const rows = await db.select().from(changeLogs).where(eq(changeLogs.entityId, 'p1'));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entityType: 'project',
        changeType: 'create',
        beforeSnapshot: null,
        reason: null,
        actor: 'human',
        afterSnapshot: { id: 'p1', name: '项目一' },
      });
    });
  });

  it('同一事务多次写入互相可见(供联动场景)', async () => {
    await withDb(async (db) => {
      await db.transaction(async (tx) => {
        await writeChangeLog(tx, {
          entityType: 'task',
          entityId: 't1',
          changeType: 'status_change',
          after: {},
          actor: 'mcp:claude-code',
        });
        const seen = await tx.select().from(changeLogs);
        expect(seen).toHaveLength(1);
        await writeChangeLog(tx, {
          entityType: 'task',
          entityId: 't1',
          changeType: 'linkage_impact',
          after: {},
          actor: 'human',
        });
      });
      expect(await db.select().from(changeLogs)).toHaveLength(2);
    });
  });
});
