import { and, desc, eq } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import {
  analysisRuns,
  materials,
  projects,
  requirementPoints,
  requirements,
  type AnalysisRunRow,
  type MaterialRow,
} from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';
import { SettingsService } from './settings.service.js';
import { chatJson, type LlmConfig } from '../llm/client.js';
import { analysisResultSchema, type AnalysisResult } from '../llm/schema.js';
import { buildSystemPrompt, buildUserPrompt } from '../llm/prompt.js';
import type { ExistingRequirementDigest } from '../llm/prompt-types.js';

export type LlmInvoker = (system: string, user: string) => Promise<unknown>;

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
}

/** 生产工厂:LLM 配置来自 settings 表(含 env 首次种子化后的值) */
export function createAnalysisService(db: ShipmateDb): AnalysisService {
  const settings = new SettingsService(db);
  return new AnalysisService(db, async (system, user) => {
    const cfg: LlmConfig = await settings.getLlmConfig();
    return chatJson(cfg, system, user);
  });
}
