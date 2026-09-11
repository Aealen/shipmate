'use server';

import type {
  RequirementPointDetail,
  RequirementPointRow,
  UpdatePointInput,
  UpdatePointResult,
} from '@shipmate/core';
import { getShipmate } from '@/lib/core';
import { toActionError, type ActionResult } from '@/lib/error';
import { revalidateApp } from '@/lib/revalidate';

/**
 * 需求点 action。
 * 约定:读 action 直接返回数据;写 action 返回 ActionResult(中文 message 供 toast)。
 * actor 固定 'human'(spec §5.1:web 门面)。
 */

// ---------- 读 ----------

/** 需求点详情(点 + 关联任务 + 变更历史)——P4 详情页 */
export async function getRequirementPoint(id: string): Promise<RequirementPointDetail> {
  const { core } = await getShipmate();
  return core.points.getRequirementPoint(id);
}

export async function listRequirementPoints(filter: {
  requirementId?: string;
  projectId?: string;
  status?: RequirementPointRow['status'];
}): Promise<RequirementPointRow[]> {
  const { core } = await getShipmate();
  return core.points.listRequirementPoints(filter);
}

// ---------- 写 ----------

/**
 * 实质修改(标题/描述 + reason 必填,version+1/状态回退/关联任务转待重估)——P4b 编辑弹窗。
 * reason 缺失在 UI 层先行校验,core 兜底 VALIDATION_ERROR。
 */
export async function updateRequirementPointAction(
  id: string,
  input: UpdatePointInput,
): Promise<ActionResult<UpdatePointResult>> {
  try {
    const { core } = await getShipmate();
    const result = await core.points.updateRequirementPoint(id, input, 'human');
    revalidateApp();
    return { ok: true, data: result };
  } catch (e) {
    return toActionError(e);
  }
}

/** 状态流转:confirm / start / complete(spec §4.1 流转表,非法流转 core 抛 INVALID_STATUS_TRANSITION) */
export async function setRequirementPointStatusAction(
  id: string,
  action: 'confirm' | 'start' | 'complete',
): Promise<ActionResult<RequirementPointRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.points.setRequirementPointStatus(id, action, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

export async function confirmRequirementPointAction(
  id: string,
): Promise<ActionResult<RequirementPointRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.points.confirmRequirementPoint(id, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}
