import { and, eq } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import { projects, requirements, type RequirementRow } from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';

const DAY_MS = 86_400_000;

/** spec §4.3 超期判定:计算态,不落库 */
export function computeOverdue(
  req: RequirementRow,
  now = Date.now(),
): { overdue: boolean; overdueDays: number; dueSoon: boolean } {
  if (!req.planDueAt || (req.status !== 'draft' && req.status !== 'confirmed')) {
    return { overdue: false, overdueDays: 0, dueSoon: false };
  }
  const diffMs = now - req.planDueAt;
  // 超期天数对正的已超期毫秒数向下取整(3.5 天 → 3 天),不能先对带符号值取整再取反
  if (diffMs > 0)
    return { overdue: true, overdueDays: Math.floor(diffMs / DAY_MS), dueSoon: false };
  const daysLeft = Math.floor(-diffMs / DAY_MS);
  return { overdue: false, overdueDays: 0, dueSoon: daysLeft <= 3 };
}

export interface CreateRequirementInput {
  projectId: string;
  title: string;
  summary?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  planStartAt?: number;
  planDueAt?: number;
}

export interface UpdateRequirementInput {
  title?: string;
  summary?: string;
  status?: 'draft' | 'confirmed' | 'done' | 'archived';
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  planStartAt?: number | null;
  planDueAt?: number | null;
}

export type RequirementWithOverdue = RequirementRow & {
  overdue: boolean;
  overdueDays: number;
  dueSoon: boolean;
};

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;

export class RequirementService {
  constructor(private db: ShipmateDb) {}

  async createRequirement(input: CreateRequirementInput, actor: Actor): Promise<RequirementRow> {
    const title = input.title?.trim();
    if (!title) throw new DomainError('VALIDATION_ERROR', '需求标题不能为空');
    if (input.priority && !PRIORITIES.includes(input.priority)) {
      throw new DomainError('VALIDATION_ERROR', `非法优先级 ${input.priority}`);
    }
    return this.db.transaction(async (tx) => {
      // 存在性检查须取首行判空:drizzle select 返回数组,空数组为 truthy,不能直接取反
      const project = (await tx.select().from(projects).where(eq(projects.id, input.projectId)))[0];
      if (!project) throw new DomainError('NOT_FOUND', `项目 ${input.projectId} 不存在`);
      const now = Date.now();
      const rows = await tx
        .insert(requirements)
        .values({
          id: newId(),
          projectId: input.projectId,
          title,
          summary: input.summary ?? null,
          status: 'draft',
          priority: input.priority ?? 'P2',
          planStartAt: input.planStartAt ?? null,
          planDueAt: input.planDueAt ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'requirement',
        entityId: row.id,
        changeType: 'create',
        after: row,
        actor,
      });
      return row;
    });
  }

  async updateRequirement(
    id: string,
    input: UpdateRequirementInput,
    actor: Actor,
  ): Promise<RequirementRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(requirements).where(eq(requirements.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `需求 ${id} 不存在`);

      const patch: Partial<typeof requirements.$inferInsert> = { updatedAt: Date.now() };
      let contentChanged = false;
      let statusChanged = false;

      if (input.title !== undefined && input.title.trim() !== before.title) {
        if (!input.title.trim()) throw new DomainError('VALIDATION_ERROR', '需求标题不能为空');
        patch.title = input.title.trim();
        contentChanged = true;
      }
      if (input.summary !== undefined && input.summary !== before.summary) {
        patch.summary = input.summary;
        contentChanged = true;
      }
      if (input.priority !== undefined && input.priority !== before.priority) {
        if (!PRIORITIES.includes(input.priority))
          throw new DomainError('VALIDATION_ERROR', `非法优先级 ${input.priority}`);
        patch.priority = input.priority;
        contentChanged = true;
      }
      if (input.planStartAt !== undefined && input.planStartAt !== before.planStartAt) {
        patch.planStartAt = input.planStartAt;
        contentChanged = true;
      }
      if (input.planDueAt !== undefined && input.planDueAt !== before.planDueAt) {
        patch.planDueAt = input.planDueAt;
        contentChanged = true;
      }
      if (input.status !== undefined && input.status !== before.status) {
        patch.status = input.status;
        statusChanged = true;
        if (input.status === 'done') patch.completedAt = Date.now();
        if (before.status === 'done' && input.status !== 'done') patch.completedAt = null;
      }

      if (!contentChanged && !statusChanged) return before;

      const after = (
        await tx.update(requirements).set(patch).where(eq(requirements.id, id)).returning()
      )[0]!;
      if (contentChanged) {
        await writeChangeLog(tx, {
          entityType: 'requirement',
          entityId: id,
          changeType: 'update',
          before,
          after,
          actor,
        });
      }
      if (statusChanged) {
        await writeChangeLog(tx, {
          entityType: 'requirement',
          entityId: id,
          changeType: 'status_change',
          before,
          after,
          actor,
        });
      }
      return after;
    });
  }

  async listRequirements(
    projectId: string,
    filter?: { status?: string; priority?: string; overdue?: boolean },
  ): Promise<RequirementWithOverdue[]> {
    const conds = [eq(requirements.projectId, projectId)];
    if (filter?.status)
      conds.push(eq(requirements.status, filter.status as RequirementRow['status']));
    if (filter?.priority)
      conds.push(eq(requirements.priority, filter.priority as RequirementRow['priority']));
    const rows = await this.db
      .select()
      .from(requirements)
      .where(and(...conds));
    const decorated = rows.map((r) => ({ ...r, ...computeOverdue(r) }));
    if (filter?.overdue === true) return decorated.filter((r) => r.overdue);
    return decorated;
  }
}
