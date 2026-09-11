import { changeLogs, type ChangeType, type EntityType } from '../db/schema.js';
import type { ShipmateTx } from '../db/database.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';

export interface ChangeLogInput {
  entityType: EntityType;
  entityId: string;
  changeType: ChangeType;
  before?: unknown;
  after: unknown;
  reason?: string;
  actor: Actor;
}

/**
 * 在调用方事务内写一条变更记录。
 * 规则(spec §3.7):所有业务表写操作都写 change_logs;change_logs 自身写入不再记录。
 * 必须在事务内调用 —— 单独写 log 而无业务变更没有意义。所有调用点必须 await。
 */
export async function writeChangeLog(tx: ShipmateTx, input: ChangeLogInput): Promise<void> {
  await tx.insert(changeLogs).values({
    id: newId(),
    entityType: input.entityType,
    entityId: input.entityId,
    changeType: input.changeType,
    beforeSnapshot: (input.before ?? null) as never,
    afterSnapshot: input.after as never,
    reason: input.reason ?? null,
    actor: input.actor,
    createdAt: Date.now(),
  });
}
