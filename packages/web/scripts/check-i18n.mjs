#!/usr/bin/env node
/**
 * i18n 键一致性检查(spec/计划 Task 12):
 * 递归展平 messages/zh-CN.json 与 messages/en.json 的键集合,比对差异;
 * 有任一缺失键则打印并 exit 1,否则打印对称键数 exit 0。
 * 用法:node scripts/check-i18n.mjs(pnpm -C packages/web test)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const messagesDir = path.join(root, 'messages');

/** 递归展平嵌套对象为 'a.b.c' 键数组(叶子值可为任意类型) */
function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, value]) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? flatten(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

let zh;
let en;
try {
  zh = flatten(JSON.parse(readFileSync(path.join(messagesDir, 'zh-CN.json'), 'utf8')));
  en = flatten(JSON.parse(readFileSync(path.join(messagesDir, 'en.json'), 'utf8')));
} catch (e) {
  console.error(`[i18n] messages 文件读取/解析失败:${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

const enSet = new Set(en);
const zhSet = new Set(zh);
const missingInEn = zh.filter((key) => !enSet.has(key));
const missingInZh = en.filter((key) => !zhSet.has(key));

if (missingInEn.length > 0 || missingInZh.length > 0) {
  if (missingInEn.length > 0) {
    console.error(`[i18n] en.json 缺失 ${missingInEn.length} 个键:`);
    for (const key of missingInEn) console.error(`  - ${key}`);
  }
  if (missingInZh.length > 0) {
    console.error(`[i18n] zh-CN.json 缺失 ${missingInZh.length} 个键:`);
    for (const key of missingInZh) console.error(`  - ${key}`);
  }
  process.exit(1);
}

console.log(`[i18n] zh-CN 与 en 键集合一致:共 ${zh.length} 个键,全部对称`);
