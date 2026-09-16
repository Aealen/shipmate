'use server';

import { DomainError } from '@shipmate/core';
import type {
  MaterialRow,
  ProjectRow,
  RequirementPointDetail,
  RequirementPointRow,
  RequirementRow,
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

/** P4 页面聚合数据:需求点详情 + 面包屑上下文(需求/项目)+ 溯源素材标题 */
export interface PointPageData extends RequirementPointDetail {
  requirement: RequirementRow;
  project: ProjectRow;
  /** evidences.material_id → 素材标题;标题为 null 的素材未命名 */
  materialTitles: Record<string, string | null>;
}

/**
 * P4 详情页一次取齐:core 门面未提供按 id 单查需求/项目与按 id 批量取素材的方法,
 * 此处以只读查询补齐面包屑与溯源标题;业务写入仍全部经 core 服务。
 * 需求点不存在时抛错由页面转 notFound;需求/项目因外键约束必然存在,防御性兜底 NOT_FOUND。
 */
export async function getPointPageData(pointId: string): Promise<PointPageData> {
  const { core, db } = await getShipmate();
  const detail = await core.points.getRequirementPoint(pointId);

  const requirement = await db.query.requirements.findFirst({
    where: (r, { eq }) => eq(r.id, detail.point.requirementId),
  });
  if (!requirement) {
    throw new DomainError('NOT_FOUND', `需求 ${detail.point.requirementId} 不存在`);
  }
  const project = await db.query.projects.findFirst({
    where: (p, { eq }) => eq(p.id, requirement.projectId),
  });
  if (!project) {
    throw new DomainError('NOT_FOUND', `项目 ${requirement.projectId} 不存在`);
  }

  // 溯源标题:收集 evidences 与 sourceMaterialIds 引用的素材 id,批量查标题
  const materialIds = new Set<string>(detail.point.sourceMaterialIds ?? []);
  for (const ev of detail.point.evidences ?? []) materialIds.add(ev.material_id);
  let materials: MaterialRow[] = [];
  if (materialIds.size > 0) {
    materials = await db.query.materials.findMany({
      where: (m, { inArray }) => inArray(m.id, [...materialIds]),
    });
  }
  const materialTitles: Record<string, string | null> = {};
  for (const m of materials) materialTitles[m.id] = m.title;

  return { ...detail, requirement, project, materialTitles };
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

/** 删除需求点(级联其下任务,delete 留痕)——P3 需求产出批量删除 */
export async function deleteRequirementPointAction(
  id: string,
): Promise<ActionResult<true>> {
  try {
    const { core } = await getShipmate();
    await core.points.deleteRequirementPoint(id, 'human');
    revalidateApp();
    return { ok: true, data: true };
  } catch (e) {
    return toActionError(e);
  }
}

/** 合并需求点(被并点删除留痕,evidences 汇总)——P3 三栏合并弹窗确认 */
export async function mergeRequirementPointsAction(
  pointIds: string[],
  target: { requirementId: string; title: string; description?: string },
): Promise<ActionResult<RequirementPointRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.points.mergeRequirementPoints(pointIds, target, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

/** 智能合并建议(LLM 生成,不落库)——合并弹窗「智能合并」按钮 */
export async function suggestPointMergeAction(
  pointIds: string[],
): Promise<ActionResult<{ title: string; description: string }>> {
  try {
    const { core } = await getShipmate();
    const data = await core.analysis.suggestPointMerge(pointIds, 'human');
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}
