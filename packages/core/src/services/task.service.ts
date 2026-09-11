import { and, eq, inArray } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import { requirementPoints, requirements, tasks, type TaskRow } from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';

export type TaskAction = 'start' | 'complete';

/** spec §4.2:合法流转表;needs_reassessment 仅由联动写入与 confirmTaskReassessment 移出 */
const TASK_TRANSITIONS: Partial<Record<TaskRow['status'], Partial<Record<TaskAction, TaskRow['status']>>>> = {
  pending: { start: 'in_progress' },
  in_progress: { complete: 'done' },
};

export interface CreateTaskInput {
  requirementPointId: string;
  title: string;
  description?: string;
  sortOrder?: number;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  sortOrder?: number;
}

export interface ListTaskFilter {
  requirementPointId?: string;
  projectId?: string;
  status?: TaskRow['status'];
}

export class TaskService {
  constructor(private db: ShipmateDb) {}

  async createTask(input: CreateTaskInput, actor: Actor): Promise<TaskRow> {
    const title = input.title?.trim();
    if (!title) throw new DomainError('VALIDATION_ERROR', '任务标题不能为空');
    return this.db.transaction(async (tx) => {
      const point = (await tx.select().from(requirementPoints).where(eq(requirementPoints.id, input.requirementPointId)))[0];
      if (!point) throw new DomainError('NOT_FOUND', `需求点 ${input.requirementPointId} 不存在`);
      const now = Date.now();
      const rows = await tx
        .insert(tasks)
        .values({
          id: newId(),
          requirementPointId: input.requirementPointId,
          title,
          description: input.description ?? null,
          status: 'pending',
          sortOrder: input.sortOrder ?? 0,
          commitRefs: [],
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, { entityType: 'task', entityId: row.id, changeType: 'create', after: row, actor });
      return row;
    });
  }

  async updateTask(id: string, input: UpdateTaskInput, actor: Actor): Promise<TaskRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(tasks).where(eq(tasks.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `任务 ${id} 不存在`);
      const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: Date.now() };
      let changed = false;
      if (input.title !== undefined && input.title.trim() !== before.title) {
        if (!input.title.trim()) throw new DomainError('VALIDATION_ERROR', '任务标题不能为空');
        patch.title = input.title.trim();
        changed = true;
      }
      if (input.description !== undefined && input.description !== before.description) {
        patch.description = input.description;
        changed = true;
      }
      if (input.sortOrder !== undefined && input.sortOrder !== before.sortOrder) {
        patch.sortOrder = input.sortOrder;
        changed = true;
      }
      if (!changed) return before;
      const after = (await tx.update(tasks).set(patch).where(eq(tasks.id, id)).returning())[0]!;
      await writeChangeLog(tx, { entityType: 'task', entityId: id, changeType: 'update', before, after, actor });
      return after;
    });
  }

  async setTaskStatus(id: string, action: TaskAction, actor: Actor): Promise<TaskRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(tasks).where(eq(tasks.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `任务 ${id} 不存在`);
      const next = TASK_TRANSITIONS[before.status]?.[action];
      if (!next) {
        throw new DomainError('INVALID_STATUS_TRANSITION', `任务不允许从 ${before.status} 经 ${action} 流转`);
      }
      const after = (await tx.update(tasks).set({ status: next, updatedAt: Date.now() }).where(eq(tasks.id, id)).returning())[0]!;
      await writeChangeLog(tx, { entityType: 'task', entityId: id, changeType: 'status_change', before, after, actor });
      return after;
    });
  }

  async listTasks(filter: ListTaskFilter): Promise<TaskRow[]> {
    if (filter.projectId !== undefined) {
      const pointIds = (
        await this.db
          .select({ id: requirementPoints.id })
          .from(requirementPoints)
          .innerJoin(requirements, eq(requirementPoints.requirementId, requirements.id))
          .where(eq(requirements.projectId, filter.projectId))
      ).map((r) => r.id);
      if (pointIds.length === 0) return [];
      const conds = [inArray(tasks.requirementPointId, pointIds)];
      if (filter.status) conds.push(eq(tasks.status, filter.status));
      if (filter.requirementPointId) conds.push(eq(tasks.requirementPointId, filter.requirementPointId));
      return this.db.select().from(tasks).where(and(...conds));
    }
    const conds = [];
    if (filter.requirementPointId) conds.push(eq(tasks.requirementPointId, filter.requirementPointId));
    if (filter.status) conds.push(eq(tasks.status, filter.status));
    return conds.length ? this.db.select().from(tasks).where(and(...conds)) : this.db.select().from(tasks);
  }

  async confirmTaskReassessment(id: string, actor: Actor): Promise<TaskRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(tasks).where(eq(tasks.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `任务 ${id} 不存在`);
      if (before.status !== 'needs_reassessment') {
        throw new DomainError('INVALID_STATUS_TRANSITION', `任务当前状态 ${before.status},仅 needs_reassessment 可确认重估`);
      }
      const after = (await tx.update(tasks).set({ status: 'pending', updatedAt: Date.now() }).where(eq(tasks.id, id)).returning())[0]!;
      await writeChangeLog(tx, {
        entityType: 'task',
        entityId: id,
        changeType: 'status_change',
        before,
        after,
        reason: '重估确认:任务回到待办,重新走开发流程',
        actor,
      });
      return after;
    });
  }
}
