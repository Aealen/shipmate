import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type ShipmateDb = NodePgDatabase<typeof schema>;
export type ShipmateTx = Parameters<Parameters<ShipmateDb['transaction']>[0]>[0];
export { schema };

/**
 * drizzle/ 目录位置:src/db 与 dist/db 的上两级都是包根,两种运行形态下均成立。
 * bundler 场景(Next web 包)中 import.meta.url 被错位替换,且字面量 new URL 会触发
 * 静态资产分析报错,故以间接变量绕过静态分析;调用方可用 SHIPMATE_MIGRATIONS_DIR 显式覆盖。
 */
const DEFAULT_MIGRATIONS_REL = '../../drizzle';
const MIGRATIONS_FOLDER =
  process.env.SHIPMATE_MIGRATIONS_DIR ?? fileURLToPath(new URL(DEFAULT_MIGRATIONS_REL, import.meta.url));

/**
 * 创建数据库连接:pg Pool + drizzle + 执行 migrations(幂等,已应用的跳过)。
 * 时间戳列均为 bigint(Unix 毫秒),详见 schema.ts。
 */
export async function createDatabase(connectionString: string): Promise<ShipmateDb> {
  const pool = new pg.Pool({ connectionString, max: 5 });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

// ---- 测试工厂:事务回滚隔离(禁止 TRUNCATE/DELETE 清表)----
const ROLLBACK_TOKEN = Symbol('shipmate-test-rollback');

let baseDb: ShipmateDb | null = null;

/** 读取仓库根 .env 的 KEY=VALUE(零依赖,仅填充未设置的变量;readFileSync 从 node:fs 顶部导入) */
export function loadDotEnv(): void {
  try {
    const raw = readFileSync(new URL('../../../../.env', import.meta.url), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim();
    }
  } catch {
    /* .env 不存在则跳过 */
  }
}

async function getBaseDb(): Promise<ShipmateDb> {
  if (!baseDb) {
    loadDotEnv();
    const url = process.env.SHIPMATE_TEST_DATABASE_URL;
    if (!url) throw new Error('缺少 SHIPMATE_TEST_DATABASE_URL(见仓库根 .env)');
    baseDb = await createDatabase(url);
  }
  return baseDb;
}

/**
 * 测试专用:外层事务包裹 fn,fn 正常返回后强制 ROLLBACK,零残留。
 * fn 内部再开事务(drizzle)自动降级为 SAVEPOINT,不影响隔离性。
 */
export async function withDb(fn: (db: ShipmateDb) => Promise<void>): Promise<void> {
  const db = await getBaseDb();
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as ShipmateDb);
      throw ROLLBACK_TOKEN;
    });
  } catch (e) {
    if (e !== ROLLBACK_TOKEN) throw e;
  }
}
