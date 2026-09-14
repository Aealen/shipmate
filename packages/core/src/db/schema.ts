import { bigint, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

/** 置信度依据:AI 引用的素材原文段落(spec §3.5) */
export interface Evidence {
  material_id: string;
  quote: string;
}

/** 需求点冲突关系(spec §3.5 relations) */
export interface PointRelation {
  type: 'duplicate' | 'conflict';
  point_id: string;
  resolved?: boolean;
}

// §3.0 groups
export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// §3.1 projects
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  groupId: text('group_id').references(() => groups.id),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status', { enum: ['active', 'archived'] }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// §3.2 analysis_runs;draft_result 为计划补齐列(草稿暂存,不落业务表);error 为失败时的错误摘要(成功为 null)
export const analysisRuns = pgTable('analysis_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  title: text('title'),
  status: text('status', { enum: ['pending', 'done', 'failed'] }).notNull(),
  actor: text('actor').notNull(),
  draftResult: jsonb('draft_result'),
  error: text('error'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  completedAt: bigint('completed_at', { mode: 'number' }),
});

// §3.3 materials
export const materials = pgTable('materials', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  analysisRunId: text('analysis_run_id')
    .notNull()
    .references(() => analysisRuns.id),
  type: text('type', { enum: ['paste_text', 'screenshot_text', 'doc'] }).notNull(),
  title: text('title'),
  rawContent: text('raw_content').notNull(),
  actor: text('actor').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

// §3.4 requirements;moduleId 为可空分类维度(§3.9 modules,D8),回调引用延迟解析
export const requirements = pgTable('requirements', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  moduleId: text('module_id').references(() => modules.id),
  title: text('title').notNull(),
  summary: text('summary'),
  status: text('status', { enum: ['draft', 'confirmed', 'done', 'archived'] }).notNull(),
  priority: text('priority', { enum: ['P0', 'P1', 'P2', 'P3'] }).notNull(),
  planStartAt: bigint('plan_start_at', { mode: 'number' }),
  planDueAt: bigint('plan_due_at', { mode: 'number' }),
  completedAt: bigint('completed_at', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// §3.5 requirement_points(jsonb 列,服务层写行时显式给值)
export const requirementPoints = pgTable(
  'requirement_points',
  {
    id: text('id').primaryKey(),
    requirementId: text('requirement_id')
      .notNull()
      .references(() => requirements.id),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: ['draft', 'confirmed', 'developing', 'done'] }).notNull(),
    version: integer('version').notNull(),
    sourceMaterialIds: jsonb('source_material_ids').$type<string[]>(),
    evidences: jsonb('evidences').$type<Evidence[]>(),
    origin: text('origin', { enum: ['analysis', 'supplement', 'manual'] }).notNull(),
    relations: jsonb('relations').$type<PointRelation[]>(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('idx_points_req').on(t.requirementId),
    index('idx_points_req_status').on(t.requirementId, t.status),
  ],
);

// §3.6 tasks
export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    requirementPointId: text('requirement_point_id')
      .notNull()
      .references(() => requirementPoints.id),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', {
      enum: ['pending', 'in_progress', 'done', 'needs_reassessment'],
    }).notNull(),
    sortOrder: integer('sort_order').notNull(),
    commitRefs: jsonb('commit_refs').$type<string[]>(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('idx_tasks_point').on(t.requirementPointId),
    index('idx_tasks_point_sort').on(t.requirementPointId, t.sortOrder),
  ],
);

// §3.7 change_logs;change_type 在 spec 5 值基础上补 'delete'(删除实体时的快照留存)与 'revision'(AI 修订记录于应用时结转,已同步 design.md §3.7)
export const changeLogs = pgTable(
  'change_logs',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type', {
      enum: [
        'group',
        'project',
        'module',
        'analysis_run',
        'material',
        'requirement',
        'requirement_point',
        'task',
      ],
    }).notNull(),
    entityId: text('entity_id').notNull(),
    changeType: text('change_type', {
      enum: [
        'create',
        'update',
        'status_change',
        'linkage_impact',
        'discard',
        'delete',
        'revision',
      ],
    }).notNull(),
    beforeSnapshot: jsonb('before_snapshot'),
    afterSnapshot: jsonb('after_snapshot').notNull(),
    reason: text('reason'),
    actor: text('actor').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('idx_logs_entity').on(t.entityType, t.entityId, t.createdAt),
    index('idx_logs_entity_id').on(t.entityId),
  ],
);

// §3.8 settings(键值;配置类写入不记 change_logs——entity_type 枚举未含 settings,属有意为之)
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// §3.9 modules(项目内需求分类维度,纯分类容器无状态机;spec D8)
export const modules = pgTable(
  'modules',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => [index('idx_modules_project').on(t.projectId, t.sortOrder)],
);

// ---- 行类型导出(服务层统一使用)----
export type GroupRow = typeof groups.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type AnalysisRunRow = typeof analysisRuns.$inferSelect;
export type MaterialRow = typeof materials.$inferSelect;
export type RequirementRow = typeof requirements.$inferSelect;
export type RequirementPointRow = typeof requirementPoints.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type ChangeLogRow = typeof changeLogs.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;
export type ModuleRow = typeof modules.$inferSelect;

export type EntityType = (typeof changeLogs.$inferSelect)['entityType'];
export type ChangeType = (typeof changeLogs.$inferSelect)['changeType'];
