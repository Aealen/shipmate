import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
  createCore,
  createDatabase,
  type ShipmateCore,
  type ShipmateDb,
} from '@shipmate/core';

/**
 * 读取仓库根 .env(dev/start 由 pnpm -C packages/web 起动,仓库根即 cwd 上两级)。
 * core 的 loadDotEnv 以 import.meta.url 定位,bundle 中错位,故 web 侧自行实现;
 * 解析规则与 core 保持一致:KEY=VALUE、大写键、仅填充未设置的变量。
 */
function loadRootDotEnv(): void {
  try {
    const raw = readFileSync(path.resolve(process.cwd(), '../../.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim();
    }
  } catch {
    /* .env 不存在则跳过 */
  }
}

/**
 * 定位 @shipmate/core 包内 drizzle 迁移目录:
 * server bundle 中 import.meta.url 已错位、createRequire 亦不可用,
 * 故经 node_modules/@shipmate/core 的 pnpm symlink realpath 解析包真实根目录。
 * (pnpm dev/start 的 cwd 为 packages/web,workspace 依赖必然出现在其 node_modules。)
 */
function resolveCoreDrizzleDir(): string {
  const coreRoot = realpathSync(
    path.join(process.cwd(), 'node_modules', '@shipmate', 'core'),
  );
  return path.join(coreRoot, 'drizzle');
}

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
  loadRootDotEnv();
  const url = process.env.SHIPMATE_DATABASE_URL;
  if (!url) {
    throw new Error('缺少 SHIPMATE_DATABASE_URL(见仓库根 .env,参考 .env.example)');
  }
  // bundler 下 core 无法自行定位迁移目录,显式注入(见 resolveCoreDrizzleDir)
  process.env.SHIPMATE_MIGRATIONS_DIR ??= resolveCoreDrizzleDir();
  const db = await createDatabase(url);
  const core = createCore(db);
  // spec §10:env 仅作 LLM 配置首次启动默认值;settings 已存在的 key 不覆盖
  await core.settings.ensureSeededFromEnv();
  return { db, core };
}

export function getShipmate(): Promise<Shipmate> {
  globalForShipmate.__shipmate__ ??= init().catch((e) => {
    // 失败不缓存:env 缺失/DB 未起等临时故障修复后,下一次请求可重试
    globalForShipmate.__shipmate__ = undefined;
    throw e;
  });
  return globalForShipmate.__shipmate__;
}
