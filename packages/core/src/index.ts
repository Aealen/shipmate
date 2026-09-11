export const CORE_VERSION = '0.1.0' as const;

export { DomainError, type DomainErrorCode } from './errors.js';
export type { Actor } from './types.js';
export { newId } from './db/id.js';
export { createDatabase, withDb, schema, type ShipmateDb, type ShipmateTx } from './db/database.js';
export * from './db/schema.js';
export { GroupService, type CreateGroupInput, type GroupSummary, type GroupWithCount } from './services/group.service.js';
export {
  ProjectService,
  type CreateProjectInput,
  type ProjectSummary,
} from './services/project.service.js';
export { AuditService, type AuditReport, type ActorKind } from './services/audit.service.js';
