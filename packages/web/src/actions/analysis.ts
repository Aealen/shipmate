'use server';

import { eq } from 'drizzle-orm';
import {
  analysisResultSchema,
  analysisRuns,
  type AnalysisResult,
  type AnalysisRunDetail,
  type AnalysisRunRow,
  type AnalysisRunSummary,
  type ConflictDecision,
  type CreateRequirementInput,
  type MaterialRow,
  type RequirementRow,
  type RequirementWithOverdue,
  type ReviseDraftTarget,
  type UpdateRequirementInput,
} from '@shipmate/core';
import { getShipmate } from '@/lib/core';
import { toActionError, type ActionResult } from '@/lib/error';
import { revalidateApp } from '@/lib/revalidate';

/**
 * 需求分析批次 action。
 * 需求(requirement)action 并入本文件:计划 File Structure 约定五文件,
 * 需求列表是 P3 需求分析页数据源的组成部分(路由表)。
 *
 * 约定:读 action 直接返回数据;写 action 返回 ActionResult(中文 message 供 toast)。
 * actor 固定 'human';startAnalysis 内部编排以 'ai:analysis' 落审计。
 */

// ---------- 读 ----------

/** 分析批次卡流(P3 上半:标题/时间/素材数/草稿统计/状态) */
export async function listAnalysisRuns(projectId: string): Promise<AnalysisRunSummary[]> {
  const { core } = await getShipmate();
  return core.analysis.listAnalysisRuns(projectId);
}

/** 批次详情(素材 + 草稿需求块 + 冲突)——P3c 工作台 / P3b 依据 Modal */
export async function getAnalysisRun(id: string): Promise<AnalysisRunDetail> {
  const { core } = await getShipmate();
  return core.analysis.getAnalysisRun(id);
}

/** 需求列表(含 overdue/overdueDays/dueSoon 装饰)——P3 下半与进度页 */
export async function listRequirements(
  projectId: string,
  filter?: { status?: string; priority?: string; overdue?: boolean },
): Promise<RequirementWithOverdue[]> {
  const { core } = await getShipmate();
  return core.requirements.listRequirements(projectId, filter);
}

// ---------- 写 ----------

export async function createAnalysisRunAction(input: {
  projectId: string;
  title?: string;
}): Promise<ActionResult<AnalysisRunRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.analysis.createAnalysisRun(input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

export async function addMaterialAction(input: {
  runId: string;
  type: MaterialRow['type'];
  title?: string;
  rawContent: string;
}): Promise<ActionResult<MaterialRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.analysis.addMaterial(input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * 更新素材标题/原文(spec §3.3 素材可更新):只更新传入的字段。
 * title 传空串时 core 置 null,前端显示「未命名素材」回退。
 */
export async function updateMaterialAction(
  id: string,
  input: { title?: string; rawContent?: string },
): Promise<ActionResult<MaterialRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.analysis.updateMaterial(id, input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

/** 开始分析(调 LLM,耗时可达模型 timeout;调用方自行 loading 态) */
export async function startAnalysisAction(runId: string): Promise<ActionResult<AnalysisRunRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.analysis.startAnalysis(runId, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * P3c 工作台的草稿编辑写回(spec §9 主链路「Web 端编辑草稿」)。
 * core 的 applyAnalysisRun 只按 Run 内暂存草稿落库、未提供草稿编辑 API,
 * 而草稿本就是「暂存于 Run 自身、不落业务表」的 UI 工作区数据(§9),
 * 故此处经 zod 校验后直接更新 analysis_runs.draft_result,
 * 后续 applyAnalysisRunAction 仍走 core 完整落库管道(勾选/裁决/事务)。
 */
export async function saveAnalysisDraftAction(
  runId: string,
  draft: AnalysisResult,
): Promise<ActionResult<AnalysisRunRow>> {
  const parsed = analysisResultSchema.safeParse(draft);
  if (!parsed.success) {
    const at = parsed.error.issues[0]?.path.join('.');
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: `草稿结构不合法${at ? `:${at}` : ''}`,
    };
  }
  try {
    const { db } = await getShipmate();
    const rows = await db
      .update(analysisRuns)
      .set({ draftResult: parsed.data as never })
      .where(eq(analysisRuns.id, runId))
      .returning();
    if (rows.length === 0) {
      return { ok: false, code: 'NOT_FOUND', message: `分析批次 ${runId} 不存在` };
    }
    revalidateApp();
    return { ok: true, data: rows[0]! };
  } catch (e) {
    return toActionError(e);
  }
}

/** 应用草稿:重复并入/相悖裁决(decisions)/补充追加 → 新增需求落库 */
export async function applyAnalysisRunAction(
  runId: string,
  options?: {
    selectedRequirements?: string[];
    selectedSupplements?: string[];
    decisions?: ConflictDecision[];
  },
): Promise<ActionResult<RequirementRow[]>> {
  try {
    const { core } = await getShipmate();
    const rows = await core.analysis.applyAnalysisRun(runId, options, 'human');
    revalidateApp();
    return { ok: true, data: rows };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * AI 修订结果中的「修订后内容」客户端结构类型。
 * core 侧 DraftPoint/DraftRequirement 未从包顶层导出(web client 也不宜把
 * core 的 zod 运行时拖进浏览器 bundle),此处按 packages/core/src/llm/schema.ts
 * 同构声明,字段一一对应;core 返回值可结构化赋值给本类型。
 */
export interface RevisedDraftPoint {
  title: string;
  description?: string;
  confidence: number;
  evidences: { material_id: string; quote: string }[];
}

export interface RevisedDraftBlock {
  title: string;
  summary?: string;
  conflict?: {
    type: 'duplicate' | 'contradiction';
    target_requirement_title: string;
    reason?: string;
  };
  points: RevisedDraftPoint[];
}

/**
 * AI 修订(spec §9 规则 9):按批注让 LLM 重写草稿中的需求块/需求点。
 * core reviseDraft 直接把修订后整稿(含追加的块级 revisions 摘要)写回 Run
 * 草稿并写 change_logs 审计;前端随后经「应用修订」把结果同步进工作台本地
 * 草稿(saveAnalysisDraftAction),放弃则不改动本地态。
 */
export async function reviseDraftAction(
  runId: string,
  target: ReviseDraftTarget,
  annotation: string,
  keepEvidences?: boolean,
): Promise<ActionResult<{ run: AnalysisRunRow; revised: RevisedDraftPoint | RevisedDraftBlock }>> {
  try {
    const { core } = await getShipmate();
    const data = await core.analysis.reviseDraft(
      runId,
      target,
      annotation,
      { keepEvidences },
      'human',
    );
    revalidateApp();
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------- 需求写 ----------

export async function createRequirementAction(
  input: CreateRequirementInput,
): Promise<ActionResult<RequirementRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.requirements.createRequirement(input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateRequirementAction(
  id: string,
  input: UpdateRequirementInput,
): Promise<ActionResult<RequirementRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.requirements.updateRequirement(id, input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}
