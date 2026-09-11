import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, withDb } from './database.js';
import { groups, projects } from './schema.js';
import { newId } from './id.js';

const TEST_URL = process.env.SHIPMATE_TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('缺少 SHIPMATE_TEST_DATABASE_URL(见仓库根 .env)');

describe('createDatabase', () => {
  it('migrate 幂等建齐 9 张表', async () => {
    const db = await createDatabase(TEST_URL!);
    const rows = (await db.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    )) as unknown as { rows: { tablename: string }[] };
    const names = rows.rows.map((r) => r.tablename);
    for (const t of [
      'groups',
      'projects',
      'analysis_runs',
      'materials',
      'requirements',
      'requirement_points',
      'tasks',
      'change_logs',
      'settings',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('外键约束生效', async () => {
    const db = await createDatabase(TEST_URL!);
    const now = Date.now();
    await expect(
      db.insert(projects).values({
        id: newId(),
        groupId: '不存在的组',
        name: 'p',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('withDb(事务回滚隔离)', () => {
  it('事务内写入可见,回滚后零残留', async () => {
    await withDb(async (db) => {
      const now = Date.now();
      await db
        .insert(groups)
        .values({ id: newId(), name: '测试分组', sortOrder: 0, createdAt: now, updatedAt: now });
      const rows = await db.select().from(groups);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe('测试分组');
    });
    // 回滚后必须查不到
    const db = await createDatabase(TEST_URL!);
    expect(await db.select().from(groups)).toHaveLength(0);
  });

  it('service 内部事务在外层事务中变为 SAVEPOINT,同样被回滚', async () => {
    await withDb(async (db) => {
      await db.transaction(async (tx) => {
        const now = Date.now();
        await tx
          .insert(groups)
          .values({ id: newId(), name: '嵌套写入', sortOrder: 0, createdAt: now, updatedAt: now });
      });
      expect(await db.select().from(groups)).toHaveLength(1);
    });
    const db = await createDatabase(TEST_URL!);
    expect(await db.select().from(groups)).toHaveLength(0);
  });
});
