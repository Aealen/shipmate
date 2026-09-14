'use server';

import type {
  CreateModuleInput,
  ModuleRow,
  ModuleSummary,
  UpdateModuleInput,
} from '@shipmate/core';
import { getShipmate } from '@/lib/core';
import { toActionError, type ActionResult } from '@/lib/error';
import { revalidateApp } from '@/lib/revalidate';

/**
 * 模块 action(spec §3.9,需求产出的分组维度,D8)。
 * 约定同 analysis.ts:读 action 直接返回数据;写 action 返回 ActionResult
 * (中文 message 供 toast;MODULE_NAME_TAKEN 由调用方在表单内联展示)。
 * actor 固定 'human'。
 */

// ---------- 读 ----------

/** 模块列表(组序 sortOrder→name,附需求/点就绪统计)——P3 分组渲染与后续看板/进度筛选共用 */
export async function listModulesAction(projectId: string): Promise<ModuleSummary[]> {
  const { core } = await getShipmate();
  return core.modules.listModules(projectId);
}

// ---------- 写 ----------

export async function createModuleAction(
  input: CreateModuleInput,
): Promise<ActionResult<ModuleRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.modules.createModule(input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateModuleAction(
  id: string,
  input: UpdateModuleInput,
): Promise<ActionResult<ModuleRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.modules.updateModule(id, input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

/** 删除模块:其下需求转未归类(需求本身不动,core 侧逐需求写审计) */
export async function deleteModuleAction(id: string): Promise<ActionResult<undefined>> {
  try {
    const { core } = await getShipmate();
    await core.modules.deleteModule(id, 'human');
    revalidateApp();
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}
