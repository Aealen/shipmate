import {
  createCore,
  createDatabase,
  loadDotEnv,
  type ShipmateCore,
  type ShipmateDb,
} from '@shipmate/core';

type Shipmate = { db: ShipmateDb; core: ShipmateCore };

/**
 * 全局单例:loadDotEnv + createDatabase(SHIPMATE_DATABASE_URL) + createCore。
 *
 * - createDatabase 内含 drizzle migrations,必须只执行一次 → 经 globalThis 缓存 Promise,
 *   dev HMR 与多 route 并发下复用同一连接池。
 * - .env 读取由 core 的 loadDotEnv 完成(零依赖,只填充未设置的变量)。
 */
const globalForShipmate = globalThis as unknown as { __shipmate__?: Promise<Shipmate> };

async function init(): Promise<Shipmate> {
  loadDotEnv();
  const url = process.env.SHIPMATE_DATABASE_URL;
  if (!url) {
    throw new Error('缺少 SHIPMATE_DATABASE_URL(见仓库根 .env,参考 .env.example)');
  }
  const db = await createDatabase(url);
  return { db, core: createCore(db) };
}

export function getShipmate(): Promise<Shipmate> {
  globalForShipmate.__shipmate__ ??= init();
  return globalForShipmate.__shipmate__;
}
