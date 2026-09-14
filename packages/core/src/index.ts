import type { ShipmateDb } from './db/database.js';
import { GroupService } from './services/group.service.js';
import { ProjectService } from './services/project.service.js';
import { ModuleService } from './services/module.service.js';
import { RequirementService } from './services/requirement.service.js';
import { RequirementPointService } from './services/requirement-point.service.js';
import { TaskService } from './services/task.service.js';
import { AuditService } from './services/audit.service.js';
import { SettingsService } from './services/settings.service.js';
import { createAnalysisService } from './services/analysis.service.js';

export const CORE_VERSION = '0.1.0' as const;

// 错误与基础类型
export { DomainError, type DomainErrorCode } from './errors.js';
export type { Actor } from './types.js';
export { newId } from './db/id.js';
export {
  createDatabase,
  withDb,
  loadDotEnv,
  schema,
  type ShipmateDb,
  type ShipmateTx,
} from './db/database.js';
export * from './db/schema.js';

// 服务
export {
  GroupService,
  type CreateGroupInput,
  type UpdateGroupInput,
  type GroupSummary,
  type GroupWithCount,
} from './services/group.service.js';
export {
  ProjectService,
  type CreateProjectInput,
  type UpdateProjectInput,
  type ProjectSummary,
  type DeleteProjectCascade,
} from './services/project.service.js';
export {
  ModuleService,
  type CreateModuleInput,
  type UpdateModuleInput,
  type ModuleSummary,
} from './services/module.service.js';
export {
  RequirementService,
  computeOverdue,
  type CreateRequirementInput,
  type UpdateRequirementInput,
  type RequirementWithOverdue,
} from './services/requirement.service.js';
export {
  RequirementPointService,
  type PointAction,
  type UpdatePointInput,
  type UpdatePointResult,
  type RequirementPointDetail,
} from './services/requirement-point.service.js';
export {
  TaskService,
  type TaskAction,
  type CreateTaskInput,
  type UpdateTaskInput,
  type ListTaskFilter,
} from './services/task.service.js';
export { AuditService, type AuditReport, type ActorKind } from './services/audit.service.js';
export { SettingsService } from './services/settings.service.js';
export {
  AnalysisService,
  createAnalysisService,
  type LlmInvoker,
  type LlmStreamInvoker,
  type ReviseStreamEvent,
  type AnalysisRunSummary,
  type AnalysisRunDetail,
  type ConflictDecision,
  type ConflictResolution,
  type ReviseDraftTarget,
} from './services/analysis.service.js';
export { analysisResultSchema, type AnalysisResult } from './llm/schema.js';
export { chatJson, chatJsonStream, type LlmConfig } from './llm/client.js';
export { buildSystemPrompt, buildUserPrompt } from './llm/prompt.js';
export { writeChangeLog, type ChangeLogInput } from './services/change-log.js';

/** 统一门面:web 与 mcp 各自 new 一个,共享同一 db 连接 */
export function createCore(db: ShipmateDb) {
  return {
    groups: new GroupService(db),
    projects: new ProjectService(db),
    modules: new ModuleService(db),
    requirements: new RequirementService(db),
    points: new RequirementPointService(db),
    tasks: new TaskService(db),
    audit: new AuditService(db),
    settings: new SettingsService(db),
    analysis: createAnalysisService(db),
  };
}

export type ShipmateCore = ReturnType<typeof createCore>;
