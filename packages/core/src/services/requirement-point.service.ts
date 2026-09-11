import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import {
  changeLogs,
  requirementPoints,
  requirements,
  tasks,
  type ChangeLogRow,
  type RequirementPointRow,
  type TaskRow,
} from '../db/schema.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';

export type PointAction = 'confirm' | 'start' | 'complete';

/** spec §4.1 显式流转表(实质修改的回退不在表内,由 updateRequirementPoint 单独处理) */
const POINT_TRANSITIONS: Partial<
  Record<RequirementPointRow['status'], Partial<Record<PointAction, RequirementPointRow['status']>>>
> = {
  draft: { confirm: 'confirmed' },
  confirmed: { start: 'developing' },
  developing: { complete: 'done' },
};

export interface UpdatePointInput {
  title?: string;
  description?: string;
  reason?: string;
}

export interface UpdatePointResult {
  point: RequirementPointRow;
  affectedTaskCount: number;
}

export interface RequirementPointDetail {
  point: RequirementPointRow;
  tasks: TaskRow[];
  changeLogs: ChangeLogRow[];
}

export class RequirementPointService {
  constructor(private db: ShipmateDb) {}

  /** spec §5.3:实质修改单事务四件事,要么全成要么全不动 */
  async updateRequirementPoint(
    id: string,
    input: UpdatePointInput,
    actor: Actor,
  ): Promise<UpdatePointResult> {
    return this.db.transaction(async (tx): Promise<UpdatePointResult> => {
      const before = (
        await tx.select().from(requirementPoints).where(eq(requirementPoints.id, id))
      )[0];
      if (!before) throw new DomainError('NOT_FOUND', `需求点 ${id} 不存在`);

      const nextTitle = input.title !== undefined ? input.title.trim() : before.title;
      const nextDesc = input.description !== undefined ? input.description : before.description;
      if (input.title !== undefined && !nextTitle)
        throw new DomainError('VALIDATION_ERROR', '需求点标题不能为空');

      const substantive = nextTitle !== before.title || nextDesc !== before.description;
      if (!substantive) return { point: before, affectedTaskCount: 0 };

      // spec §4.1:developing/done 实质修改回退 confirmed;draft 保持 draft
      const nextStatus: RequirementPointRow['status'] =
        before.status === 'developing' || before.status === 'done' ? 'confirmed' : before.status;

      const after = (
        await tx
          .update(requirementPoints)
          .set({
            title: nextTitle,
            description: nextDesc,
            status: nextStatus,
            version: before.version + 1,
            updatedAt: Date.now(),
          })
          .where(eq(requirementPoints.id, id))
          .returning()
      )[0]!;

      await writeChangeLog(tx, {
        entityType: 'requirement_point',
        entityId: id,
        changeType: 'update',
        before,
        after,
        reason: input.reason,
        actor,
      });

      // 联动:其下所有非 needs_reassessment 任务
      const affected = await tx
        .update(tasks)
        .set({ status: 'needs_reassessment', updatedAt: Date.now() })
        .where(and(eq(tasks.requirementPointId, id), ne(tasks.status, 'needs_reassessment')))
        .returning();
      for (const t of affected) {
        await writeChangeLog(tx, {
          entityType: 'task',
          entityId: t.id,
          changeType: 'status_change',
          after: t,
          reason: `需求点「${after.title}」实质修改,联动待重估`,
          actor,
        });
      }

      await writeChangeLog(tx, {
        entityType: 'requirement_point',
        entityId: id,
        changeType: 'linkage_impact',
        after,
        reason: `联动影响 ${affected.length} 个任务`,
        actor,
      });

      return { point: after, affectedTaskCount: affected.length };
    });
  }

  async setRequirementPointStatus(
    id: string,
    action: PointAction,
    actor: Actor,
  ): Promise<RequirementPointRow> {
    return this.db.transaction(async (tx) => {
      const before = (
        await tx.select().from(requirementPoints).where(eq(requirementPoints.id, id))
      )[0];
      if (!before) throw new DomainError('NOT_FOUND', `需求点 ${id} 不存在`);
      const next = POINT_TRANSITIONS[before.status]?.[action];
      if (!next) {
        throw new DomainError(
          'INVALID_STATUS_TRANSITION',
          `需求点不允许从 ${before.status} 经 ${action} 流转`,
        );
      }
      const after = (
        await tx
          .update(requirementPoints)
          .set({ status: next, updatedAt: Date.now() })
          .where(eq(requirementPoints.id, id))
          .returning()
      )[0]!;
      await writeChangeLog(tx, {
        entityType: 'requirement_point',
        entityId: id,
        changeType: 'status_change',
        before,
        after,
        actor,
      });
      return after;
    });
  }

  async confirmRequirementPoint(id: string, actor: Actor): Promise<RequirementPointRow> {
    return this.setRequirementPointStatus(id, 'confirm', actor);
  }

  async getRequirementPoint(id: string): Promise<RequirementPointDetail> {
    const point = (
      await this.db.select().from(requirementPoints).where(eq(requirementPoints.id, id))
    )[0];
    if (!point) throw new DomainError('NOT_FOUND', `需求点 ${id} 不存在`);
    const pointTasks = await this.db.select().from(tasks).where(eq(tasks.requirementPointId, id));
    const pointLogs = await this.db
      .select()
      .from(changeLogs)
      .where(eq(changeLogs.entityId, id))
      .orderBy(desc(changeLogs.createdAt));
    return { point, tasks: pointTasks, changeLogs: pointLogs };
  }

  async listRequirementPoints(filter: {
    requirementId?: string;
    projectId?: string;
    status?: RequirementPointRow['status'];
  }): Promise<RequirementPointRow[]> {
    if (filter.projectId !== undefined) {
      const reqIds = (
        await this.db
          .select({ id: requirements.id })
          .from(requirements)
          .where(eq(requirements.projectId, filter.projectId))
      ).map((r) => r.id);
      if (reqIds.length === 0) return [];
      const conds = [inArray(requirementPoints.requirementId, reqIds)];
      if (filter.status) conds.push(eq(requirementPoints.status, filter.status));
      if (filter.requirementId)
        conds.push(eq(requirementPoints.requirementId, filter.requirementId));
      return this.db
        .select()
        .from(requirementPoints)
        .where(and(...conds));
    }
    const conds = [];
    if (filter.requirementId) conds.push(eq(requirementPoints.requirementId, filter.requirementId));
    if (filter.status) conds.push(eq(requirementPoints.status, filter.status));
    return conds.length
      ? this.db
          .select()
          .from(requirementPoints)
          .where(and(...conds))
      : this.db.select().from(requirementPoints);
  }
}
