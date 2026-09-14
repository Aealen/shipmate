import { z } from 'zod';

/** spec §9:AI 结构化产出;confidence 仅展示,不参与状态决策 */
export const evidenceSchema = z.object({
  material_id: z.string().min(1),
  quote: z.string().min(1),
});

export const draftPointSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  confidence: z.number().min(0).max(1),
  evidences: z.array(evidenceSchema),
});

export const draftConflictSchema = z.object({
  type: z.enum(['duplicate', 'contradiction']),
  target_requirement_title: z.string().min(1),
  reason: z.string().optional().default(''),
});

/** reviseDraft 修订摘要:每次 AI 修订在块上追加一条(spec §9 AI 修订) */
export const draftRevisionSchema = z.object({
  at: z.number(),
  actor: z.string(),
  annotation: z.string(),
  scope: z.enum(['block', 'point']),
  pointTitle: z.string().optional(),
});

export const draftRequirementSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional().default(''),
  // AI 归类建议(spec §9 规则 10):模块名;空串 = 未归类。默认空串保证旧草稿(无该字段)兼容
  module: z.string().optional().default(''),
  conflict: draftConflictSchema.optional(),
  points: z.array(draftPointSchema),
  revisions: z.array(draftRevisionSchema).optional(),
});

export const draftSupplementSchema = z.object({
  target_requirement_title: z.string().min(1),
  points: z.array(draftPointSchema),
});

export const analysisResultSchema = z.object({
  requirements: z.array(draftRequirementSchema),
  supplements: z.array(draftSupplementSchema),
});

export type DraftPoint = z.infer<typeof draftPointSchema>;
export type DraftConflict = z.infer<typeof draftConflictSchema>;
export type DraftRevision = z.infer<typeof draftRevisionSchema>;
export type DraftRequirement = z.infer<typeof draftRequirementSchema>;
export type DraftSupplement = z.infer<typeof draftSupplementSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
