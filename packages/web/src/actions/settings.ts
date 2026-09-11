'use server';

import { chatJson, type LlmConfig } from '@shipmate/core';
import { getShipmate } from '@/lib/core';
import { toActionError, type ActionResult } from '@/lib/error';
import { revalidateApp } from '@/lib/revalidate';

/**
 * 设置 action(spec §10:settings 键值存储 + LLM 接入参数)。
 * 约定:读 action 直接返回数据;写 action 返回 ActionResult(中文 message 供 toast)。
 * 配置类写入不记 change_logs(schema §3.8 有意设计)。
 */

// ---------- 读 ----------

/** 全量键值(模型设置表单回显) */
export async function getSettings(): Promise<Record<string, unknown>> {
  const { core } = await getShipmate();
  return core.settings.all();
}

/**
 * LLM 接入参数。配置不齐时返回 null(常态路径,非故障):
 * 模型设置页按 null 展示空表单,不视为错误。
 */
export async function getLlmConfig(): Promise<LlmConfig | null> {
  const { core } = await getShipmate();
  try {
    return await core.settings.getLlmConfig();
  } catch {
    return null;
  }
}

/** 按键读取任意设置 */
export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const { core } = await getShipmate();
  return core.settings.get<T>(key);
}

// ---------- 写 ----------

export async function setSettingAction(
  key: string,
  value: unknown,
): Promise<ActionResult> {
  try {
    const { core } = await getShipmate();
    await core.settings.set(key, value);
    revalidateApp();
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveSettingsAction(
  entries: Record<string, unknown>,
): Promise<ActionResult> {
  try {
    const { core } = await getShipmate();
    await core.settings.setMany(entries);
    revalidateApp();
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * 连接测试(P8 模型设置页):以当前配置发最小 JSON 请求。
 * 无论成功失败都返回结构化结果,由 UI 呈现,不抛错。
 */
export async function testLlmConnectionAction(): Promise<
  { ok: true; model: string } | { ok: false; message: string }
> {
  try {
    const { core } = await getShipmate();
    const cfg = await core.settings.getLlmConfig();
    await chatJson(cfg, '连通性测试,始终返回 JSON。', '请返回 {"ok":true}');
    return { ok: true, model: cfg.model };
  } catch (e) {
    return toActionError(e);
  }
}
