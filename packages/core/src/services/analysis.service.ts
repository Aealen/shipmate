import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { ShipmateDb, ShipmateTx } from '../db/database.js';
import {
  analysisRuns,
  materials,
  projects,
  requirementPoints,
  requirements,
  tasks,
  type AnalysisRunRow,
  type MaterialRow,
  type RequirementPointRow,
  type RequirementRow,
} from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';
import { SettingsService } from './settings.service.js';
import { chatJson, type LlmConfig } from '../llm/client.js';
import { analysisResultSchema, type AnalysisResult, type DraftPoint, type DraftRequirement } from '../llm/schema.js';
import { buildSystemPrompt, buildUserPrompt } from '../llm/prompt.js';
import type { ExistingRequirementDigest } from '../llm/prompt-types.js';

export type LlmInvoker = (system: string, user: string) => Promise<unknown>;

/** 冲突处置决策(spec §9 规则 8):duplicate → merge/create_anyway/skip;contradiction → use_new/use_old/keep_both */
export type ConflictResolution = 'merge' | 'create_anyway' | 'skip' | 'use_new' | 'use_old' | 'keep_both';

/** 按草稿块 title 定位的裁决决定(草稿未落库,无 id 可用) */
export type ConflictDecision = {
  requirementTitle: string;
  resolution: ConflictResolution;
};

export interface AnalysisRunSummary extends AnalysisRunRow {
  materialCount: number;
  draftRequirementCount: number;
}

export interface AnalysisRunDetail {
  run: AnalysisRunRow;
  materials: MaterialRow[];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function defaultRunTitle(now = new Date()): string {
  return `素材分析 ${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function withoutDraft(run: AnalysisRunRow): AnalysisRunRow {
  return { ...run, draftResult: null };
}

function draftCount(draft: AnalysisResult | null): number {
  if (!draft) return 0;
  return draft.requirements.length + draft.supplements.length;
}

export class AnalysisService {
  constructor(
    private db: ShipmateDb,
    private llm: LlmInvoker,
  ) {}

  async createAnalysisRun(input: { projectId: string; title?: string }, actor: Actor): Promise<AnalysisRunRow> {
    return this.db.transaction(async (tx) => {
      const project = (await tx.select().from(projects).where(eq(projects.id, input.projectId)))[0];
      if (!project) throw new DomainError('NOT_FOUND', `项目 ${input.projectId} 不存在`);
      const now = Date.now();
      const rows = await tx
        .insert(analysisRuns)
        .values({ id: newId(), projectId: input.projectId, title: input.title?.trim() || defaultRunTitle(), status: 'pending', actor, createdAt: now })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, { entityType: 'analysis_run', entityId: row.id, changeType: 'create', after: withoutDraft(row), actor });
      return row;
    });
  }

  async addMaterial(input: { runId: string; type: MaterialRow['type']; title?: string; rawContent: string }, actor: Actor): Promise<MaterialRow> {
    if (!input.rawContent?.trim()) throw new DomainError('VALIDATION_ERROR', '素材内容不能为空');
    return this.db.transaction(async (tx) => {
      const run = (await tx.select().from(analysisRuns).where(eq(analysisRuns.id, input.runId)))[0];
      if (!run) throw new DomainError('NOT_FOUND', `分析批次 ${input.runId} 不存在`);
      const rows = await tx
        .insert(materials)
        .values({
          id: newId(),
          projectId: run.projectId,
          analysisRunId: run.id,
          type: input.type,
          title: input.title ?? null,
          rawContent: input.rawContent,
          actor,
          createdAt: Date.now(),
        })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, { entityType: 'material', entityId: row.id, changeType: 'create', after: row, actor });
      return row;
    });
  }

  /** spec §9 主链路:汇集素材 → LLM 结构化输出 → 草稿暂存 Run(不落业务表) */
  async startAnalysis(runId: string, actor: Actor): Promise<AnalysisRunRow> {
    const run = (await this.db.select().from(analysisRuns).where(eq(analysisRuns.id, runId)))[0];
    if (!run) throw new DomainError('NOT_FOUND', `分析批次 ${runId} 不存在`);
    const mats = await this.db.select().from(materials).where(eq(materials.analysisRunId, runId));
    if (mats.length === 0) throw new DomainError('VALIDATION_ERROR', '批次内没有素材,请先添加素材');

    const existing = await this.collectExistingDigest(run.projectId);
    const user = buildUserPrompt(mats, existing);
    const system = buildSystemPrompt();

    try {
      const raw = await this.llm(system, user);
      const parsed = this.parseResult(raw);
      return await this.db.transaction(async (tx) => {
        const updated = (
          await tx
            .update(analysisRuns)
            .set({ status: 'done', draftResult: parsed as never, completedAt: Date.now() })
            .where(eq(analysisRuns.id, runId))
            .returning()
        )[0]!;
        await writeChangeLog(tx, {
          entityType: 'analysis_run',
          entityId: runId,
          changeType: 'status_change',
          before: { ...run, draftResult: null },
          after: withoutDraft(updated),
          reason: 'AI 分析完成,产出草稿已暂存',
          actor,
        });
        return updated;
      });
    } catch (e) {
      if (e instanceof DomainError && (e.code === 'LLM_ERROR' || e.code === 'LLM_SCHEMA_MISMATCH')) {
        await this.markFailed(runId, actor, e.message);
        throw e;
      }
      if (e instanceof Error && e.name === 'ZodError') {
        const msg = `LLM 产出不合 schema:${e.message.slice(0, 200)}`;
        await this.markFailed(runId, actor, msg);
        throw new DomainError('LLM_SCHEMA_MISMATCH', msg);
      }
      throw e;
    }
  }

  async listAnalysisRuns(projectId: string, filter?: { status?: AnalysisRunRow['status'] }): Promise<AnalysisRunSummary[]> {
    const rows = await this.db
      .select()
      .from(analysisRuns)
      .where(
        filter?.status
          ? and(eq(analysisRuns.projectId, projectId), eq(analysisRuns.status, filter.status))
          : eq(analysisRuns.projectId, projectId),
      )
      .orderBy(desc(analysisRuns.createdAt));
    const allMats = await this.db.select().from(materials).where(eq(materials.projectId, projectId));
    return rows.map((r) => ({
      ...r,
      materialCount: allMats.filter((m) => m.analysisRunId === r.id).length,
      draftRequirementCount: draftCount(r.draftResult as AnalysisResult | null),
    }));
  }

  async getAnalysisRun(id: string): Promise<AnalysisRunDetail> {
    const run = (await this.db.select().from(analysisRuns).where(eq(analysisRuns.id, id)))[0];
    if (!run) throw new DomainError('NOT_FOUND', `分析批次 ${id} 不存在`);
    const mats = await this.db.select().from(materials).where(eq(materials.analysisRunId, id));
    return { run, materials: mats };
  }

  /**
   * spec §9 规则 8 + §8 apply_analysis_run:
   * 选中草稿块事务落库;重复默认并入;相悖强制人工裁决;补充仅追加新点。
   */
  async applyAnalysisRun(
    runId: string,
    options?: { selectedRequirements?: string[]; selectedSupplements?: string[]; decisions?: ConflictDecision[] },
    actor: Actor = 'human',
  ): Promise<RequirementRow[]> {
    return this.db.transaction(async (tx): Promise<RequirementRow[]> => {
      const run = (await tx.select().from(analysisRuns).where(eq(analysisRuns.id, runId)))[0];
      if (!run) throw new DomainError('NOT_FOUND', `分析批次 ${runId} 不存在`);
      const draft = run.draftResult as AnalysisResult | null;
      if (!draft) throw new DomainError('VALIDATION_ERROR', '该批次没有分析草稿,请先 start_analysis');

      const decisionMap = new Map((options?.decisions ?? []).map((d) => [d.requirementTitle, d.resolution]));
      const picked = (title: string) => !options?.selectedRequirements || options.selectedRequirements.includes(title);

      // 冲突类型与决策合法性 + 相悖强制裁决前置校验(避免半途失败)
      const unresolved: string[] = [];
      for (const block of draft.requirements) {
        if (!picked(block.title)) continue;
        const decision = decisionMap.get(block.title);
        if (block.conflict?.type === 'contradiction') {
          if (!decision) unresolved.push(block.title);
          else if (!['use_new', 'use_old', 'keep_both'].includes(decision)) {
            throw new DomainError('VALIDATION_ERROR', `相悖块「${block.title}」的处置只能是 use_new/use_old/keep_both`);
          }
        } else if (block.conflict?.type === 'duplicate' && decision && !['merge', 'create_anyway', 'skip'].includes(decision)) {
          throw new DomainError('VALIDATION_ERROR', `重复块「${block.title}」的处置只能是 merge/create_anyway/skip`);
        }
      }
      if (unresolved.length > 0) {
        throw new DomainError('VALIDATION_ERROR', `相悖块必须人工裁决:${unresolved.join('、')}`, { unresolved });
      }

      const created: RequirementRow[] = [];

      for (const block of draft.requirements) {
        if (!picked(block.title)) continue;
        const conflict = block.conflict;
        const decision = decisionMap.get(block.title);

        if (conflict?.type === 'contradiction') {
          const resolution = decision as 'use_new' | 'use_old' | 'keep_both';
          const target = await this.findByTitleWithinTx(tx, run.projectId, conflict.target_requirement_title);
          if (resolution === 'use_old') {
            await this.writeDiscardLog(tx, runId, block, `相悖裁决:采用已有需求,放弃草稿「${block.title}」`, actor);
            continue;
          }
          const req = await this.insertDraftRequirement(tx, run, block, actor);
          if (resolution === 'keep_both' && target) {
            await this.linkRelations(tx, req.id, target.id, 'conflict');
          }
          if (resolution === 'use_new' && target) {
            await this.reassessTargetTasks(tx, target.id, block.title, actor);
          }
          created.push(req);
          continue;
        }

        if (conflict?.type === 'duplicate') {
          const resolution = decision ?? 'merge';
          if (resolution === 'skip') {
            await this.writeDiscardLog(tx, runId, block, `重复块跳过:「${block.title}」`, actor);
            continue;
          }
          const target = await this.findByTitleWithinTx(tx, run.projectId, conflict.target_requirement_title);
          if (resolution === 'merge' && target) {
            await this.mergeIntoRequirement(tx, target.id, block, actor);
            continue;
          }
          const req = await this.insertDraftRequirement(tx, run, block, actor);
          if (target) await this.linkRelations(tx, req.id, target.id, 'duplicate');
          created.push(req);
          continue;
        }

        created.push(await this.insertDraftRequirement(tx, run, block, actor));
      }

      for (const supp of draft.supplements) {
        if (options?.selectedSupplements && !options.selectedSupplements.includes(supp.target_requirement_title)) continue;
        const target = await this.findByTitleWithinTx(tx, run.projectId, supp.target_requirement_title);
        if (target) {
          for (const p of supp.points) await this.insertDraftPoint(tx, target.id, p, 'supplement', actor);
        } else {
          created.push(
            await this.insertDraftRequirement(
              tx,
              run,
              { title: supp.target_requirement_title, summary: '', points: supp.points },
              actor,
            ),
          );
        }
      }

      return created;
    });
  }

  private parseResult(raw: unknown): AnalysisResult {
    const parsed = analysisResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DomainError(
        'LLM_SCHEMA_MISMATCH',
        `LLM 产出不合 schema:${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`,
      );
    }
    return parsed.data;
  }

  private async markFailed(runId: string, actor: Actor, reason: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const updated = (
        await tx
          .update(analysisRuns)
          .set({ status: 'failed', completedAt: Date.now() })
          .where(eq(analysisRuns.id, runId))
          .returning()
      )[0];
      if (updated) {
        await writeChangeLog(tx, {
          entityType: 'analysis_run',
          entityId: runId,
          changeType: 'status_change',
          after: withoutDraft(updated),
          reason,
          actor,
        });
      }
    });
  }

  private async collectExistingDigest(projectId: string): Promise<ExistingRequirementDigest[]> {
    const reqs = await this.db.select().from(requirements).where(eq(requirements.projectId, projectId));
    return Promise.all(
      reqs.map(async (r) => {
        const pts = await this.db.select().from(requirementPoints).where(eq(requirementPoints.requirementId, r.id));
        return {
          id: r.id,
          title: r.title,
          summary: r.summary ?? '',
          points: pts.map((p) => ({ id: p.id, title: p.title, status: p.status })),
        };
      }),
    );
  }

  private async findByTitleWithinTx(tx: ShipmateTx, projectId: string, title: string): Promise<RequirementRow | undefined> {
    return (
      await tx
        .select()
        .from(requirements)
        .where(and(eq(requirements.projectId, projectId), eq(requirements.title, title)))
    )[0];
  }

  private async writeDiscardLog(tx: ShipmateTx, runId: string, block: unknown, reason: string, actor: Actor): Promise<void> {
    await writeChangeLog(tx, { entityType: 'analysis_run', entityId: runId, changeType: 'discard', after: block, reason, actor });
  }

  private async insertDraftRequirement(tx: ShipmateTx, run: AnalysisRunRow, block: DraftRequirement, actor: Actor): Promise<RequirementRow> {
    const now = Date.now();
    const req = (
      await tx
        .insert(requirements)
        .values({
          id: newId(),
          projectId: run.projectId,
          title: block.title,
          summary: block.summary || null,
          status: 'draft',
          priority: 'P2',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    for (const p of block.points) await this.insertDraftPoint(tx, req.id, p, 'analysis', actor);
    await writeChangeLog(tx, {
      entityType: 'requirement',
      entityId: req.id,
      changeType: 'create',
      after: req,
      reason: `分析批次应用:${run.title ?? run.id}`,
      actor,
    });
    return req;
  }

  private async insertDraftPoint(
    tx: ShipmateTx,
    requirementId: string,
    p: DraftPoint,
    origin: 'analysis' | 'supplement',
    actor: Actor,
  ): Promise<RequirementPointRow> {
    const now = Date.now();
    const row = (
      await tx
        .insert(requirementPoints)
        .values({
          id: newId(),
          requirementId,
          title: p.title,
          description: p.description || null,
          status: 'draft',
          version: 1,
          sourceMaterialIds: [...new Set(p.evidences.map((e) => e.material_id))],
          evidences: p.evidences,
          origin,
          relations: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    await writeChangeLog(tx, { entityType: 'requirement_point', entityId: row.id, changeType: 'create', after: row, actor });
    return row;
  }

  /** 新需求全部点与目标需求全部点双向记 relations */
  private async linkRelations(tx: ShipmateTx, newRequirementId: string, targetRequirementId: string, type: 'duplicate' | 'conflict'): Promise<void> {
    const newPoints = await tx.select().from(requirementPoints).where(eq(requirementPoints.requirementId, newRequirementId));
    const targetPoints = await tx.select().from(requirementPoints).where(eq(requirementPoints.requirementId, targetRequirementId));
    for (const np of newPoints) {
      for (const tp of targetPoints) {
        await tx.update(requirementPoints)
          .set({ relations: [...(np.relations ?? []), { type, point_id: tp.id }] })
          .where(eq(requirementPoints.id, np.id));
        await tx.update(requirementPoints)
          .set({ relations: [...(tp.relations ?? []), { type, point_id: np.id }] })
          .where(eq(requirementPoints.id, tp.id));
      }
    }
  }

  /** 相悖裁决 use_new:目标需求下全部任务打 needs_reassessment(spec 规则 8) */
  private async reassessTargetTasks(tx: ShipmateTx, targetRequirementId: string, newTitle: string, actor: Actor): Promise<void> {
    const pointIds = (
      await tx.select({ id: requirementPoints.id }).from(requirementPoints).where(eq(requirementPoints.requirementId, targetRequirementId))
    ).map((r) => r.id);
    if (pointIds.length === 0) return;
    const affected = await tx
      .update(tasks)
      .set({ status: 'needs_reassessment', updatedAt: Date.now() })
      .where(and(inArray(tasks.requirementPointId, pointIds), ne(tasks.status, 'needs_reassessment')))
      .returning();
    for (const t of affected) {
      await writeChangeLog(tx, {
        entityType: 'task',
        entityId: t.id,
        changeType: 'status_change',
        after: t,
        reason: `相悖裁决:采用新需求「${newTitle}」,旧任务待重估`,
        actor,
      });
    }
  }

  /** 重复块 merge:点级 title 匹配则 evidences 并入,否则作为新点追加进目标需求 */
  private async mergeIntoRequirement(tx: ShipmateTx, targetRequirementId: string, block: DraftRequirement, actor: Actor): Promise<void> {
    const existing = await tx.select().from(requirementPoints).where(eq(requirementPoints.requirementId, targetRequirementId));
    for (const p of block.points) {
      const match = existing.find((e) => e.title === p.title);
      if (match) {
        const after = (
          await tx
            .update(requirementPoints)
            .set({
              evidences: [...(match.evidences ?? []), ...p.evidences] as never,
              sourceMaterialIds: [...new Set([...(match.sourceMaterialIds ?? []), ...p.evidences.map((e) => e.material_id)])] as never,
              updatedAt: Date.now(),
            })
            .where(eq(requirementPoints.id, match.id))
            .returning()
        )[0]!;
        await writeChangeLog(tx, {
          entityType: 'requirement_point',
          entityId: match.id,
          changeType: 'update',
          before: match,
          after,
          reason: `重复块「${block.title}」素材并入`,
          actor,
        });
      } else {
        await this.insertDraftPoint(tx, targetRequirementId, p, 'analysis', actor);
      }
    }
  }
}

/** 生产工厂:LLM 配置来自 settings 表(含 env 首次种子化后的值) */
export function createAnalysisService(db: ShipmateDb): AnalysisService {
  const settings = new SettingsService(db);
  return new AnalysisService(db, async (system, user) => {
    const cfg: LlmConfig = await settings.getLlmConfig();
    return chatJson(cfg, system, user);
  });
}
