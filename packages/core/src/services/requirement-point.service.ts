import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import {
  changeLogs,
  requirementPoints,
  requirements,
  tasks,
  type ChangeLogRow,
  type Evidence,
  type RequirementPointRow,
  type TaskRow,
} from '../db/schema.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { newId } from '../db/id.js';
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

  /** spec §5.3:实质修改单事务四件事,要么全成要么全不动
   *  opts.changeType:审计类型,默认 'update';AI 修订(revisePoint)传 'revision' 以在时间线区分留痕 */
  async updateRequirementPoint(
    id: string,
    input: UpdatePointInput,
    actor: Actor,
    opts?: { changeType?: 'update' | 'revision' },
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
        changeType: opts?.changeType ?? 'update',
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

  /** 删除需求点(级联其下任务),delete 快照留痕(spec §3.7 changeType='delete') */
  async deleteRequirementPoint(id: string, actor: Actor): Promise<void> {
    return this.db.transaction(async (tx) => {
      const before = (
        await tx.select().from(requirementPoints).where(eq(requirementPoints.id, id))
      )[0];
      if (!before) throw new DomainError('NOT_FOUND', `需求点 ${id} 不存在`);
      await tx.delete(tasks).where(eq(tasks.requirementPointId, id));
      await tx.delete(requirementPoints).where(eq(requirementPoints.id, id));
      await writeChangeLog(tx, {
        entityType: 'requirement_point',
        entityId: id,
        changeType: 'delete',
        before,
        after: { deleted: true },
        reason: '删除需求点',
        actor,
      });
    });
  }

  /**
   * 合并需求点:在目标需求下新建合并点(evidences 按所选点顺序汇总),
   * 其余被合并点连同其任务一并删除留痕;新点 create + 各被并点 delete 均记 change_logs,
   * 同一事务要么全成要么全不动。跨项目/目标需求不存在/少于 2 个点均拒绝。
   */
  async mergeRequirementPoints(
    pointIds: string[],
    target: { requirementId: string; title: string; description?: string },
    actor: Actor,
  ): Promise<RequirementPointRow> {
    if (!Array.isArray(pointIds) || pointIds.length < 2)
      throw new DomainError('VALIDATION_ERROR', '合并至少需要选择 2 个需求点');
    const unique = [...new Set(pointIds)];
    if (unique.length !== pointIds.length)
      throw new DomainError('VALIDATION_ERROR', '合并列表存在重复需求点');
    const title = target.title?.trim();
    if (!title) throw new DomainError('VALIDATION_ERROR', '合并后标题不能为空');

    return this.db.transaction(async (tx): Promise<RequirementPointRow> => {
      const rows = await tx
        .select()
        .from(requirementPoints)
        .where(inArray(requirementPoints.id, unique));
      if (rows.length !== unique.length)
        throw new DomainError('NOT_FOUND', '部分需求点不存在或已被删除');
      const reqRows = await tx
        .select()
        .from(requirements)
        .where(inArray(requirements.id, [...new Set(rows.map((r) => r.requirementId))]));
      const projectIds = new Set(reqRows.map((r) => r.projectId));
      if (projectIds.size > 1)
        throw new DomainError('VALIDATION_ERROR', '跨项目的需求点不能合并');
      const targetReq = (
        await tx.select().from(requirements).where(eq(requirements.id, target.requirementId))
      )[0];
      if (!targetReq) throw new DomainError('NOT_FOUND', `目标需求 ${target.requirementId} 不存在`);
      if (!projectIds.has(targetReq.projectId))
        throw new DomainError('VALIDATION_ERROR', '目标需求与所选需求点不属于同一项目');

      // evidences 按所选点顺序汇总(同一素材引用原样保留,合并不破坏溯源)
      const evidences = rows.flatMap((r): Evidence[] => r.evidences ?? []);
      const sourceMaterialIds = [
        ...new Set(rows.flatMap((r) => r.sourceMaterialIds ?? [])),
      ];
      const created = (
        await tx
          .insert(requirementPoints)
          .values({
            id: newId(),
            requirementId: target.requirementId,
            title,
            description: target.description?.trim() || null,
            status: 'draft',
            version: 1,
            origin: 'manual',
            sourceMaterialIds,
            evidences,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          .returning()
      )[0]!;

      for (const r of rows) {
        await tx.delete(tasks).where(eq(tasks.requirementPointId, r.id));
        await tx.delete(requirementPoints).where(eq(requirementPoints.id, r.id));
        await writeChangeLog(tx, {
          entityType: 'requirement_point',
          entityId: r.id,
          changeType: 'delete',
          before: r,
          after: { deleted: true, mergedInto: created.id },
          reason: `合并进「${created.title}」`,
          actor,
        });
      }
      await writeChangeLog(tx, {
        entityType: 'requirement_point',
        entityId: created.id,
        changeType: 'create',
        after: created,
        reason: `由 ${rows.length} 个需求点合并生成`,
        actor,
      });
      return created;
    });
  }
}
