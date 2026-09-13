import { desc, eq, inArray, isNull } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import {
  analysisRuns,
  changeLogs,
  groups,
  materials,
  projects,
  requirementPoints,
  requirements,
  tasks,
  type ChangeLogRow,
  type ProjectRow,
} from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';
import { computeOverdue } from './requirement.service.js';

export interface CreateProjectInput {
  groupId?: string;
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: 'active' | 'archived';
}

export type PointStatusKey = 'draft' | 'confirmed' | 'developing' | 'done';

/** 删除项目的级联统计(五类从属数据,change_logs 不在其中——历史永久保留) */
export interface DeleteProjectCascade {
  requirements: number;
  points: number;
  tasks: number;
  runs: number;
  materials: number;
}

export interface ProjectSummary {
  project: ProjectRow;
  requirementTotal: number;
  requirementDone: number;
  overdueRequirementCount: number;
  pointStatusCounts: Record<PointStatusKey, number>;
  recentChanges: ChangeLogRow[];
}

export class ProjectService {
  constructor(private db: ShipmateDb) {}

  async createProject(input: CreateProjectInput, actor: Actor): Promise<ProjectRow> {
    const name = input.name?.trim();
    if (!name) throw new DomainError('VALIDATION_ERROR', '项目名不能为空');
    return this.db.transaction(async (tx) => {
      if (input.groupId !== undefined) {
        // 存在性检查须取首行判空:drizzle select 返回数组,空数组为 truthy,不能直接取反
        const group = (await tx.select().from(groups).where(eq(groups.id, input.groupId)))[0];
        if (!group) throw new DomainError('NOT_FOUND', `分组 ${input.groupId} 不存在`);
      }
      const now = Date.now();
      const rows = await tx
        .insert(projects)
        .values({
          id: newId(),
          groupId: input.groupId ?? null,
          name,
          description: input.description ?? null,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'project',
        entityId: row.id,
        changeType: 'create',
        after: row,
        actor,
      });
      return row;
    });
  }

  async updateProject(id: string, input: UpdateProjectInput, actor: Actor): Promise<ProjectRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(projects).where(eq(projects.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `项目 ${id} 不存在`);

      const patch: Partial<typeof projects.$inferInsert> = { updatedAt: Date.now() };
      let nameChanged = false;
      let descChanged = false;
      let statusChanged = false;
      if (input.name !== undefined && input.name.trim() !== before.name) {
        if (!input.name.trim()) throw new DomainError('VALIDATION_ERROR', '项目名不能为空');
        patch.name = input.name.trim();
        nameChanged = true;
      }
      if (input.description !== undefined && input.description !== before.description) {
        patch.description = input.description;
        descChanged = true;
      }
      if (input.status !== undefined && input.status !== before.status) {
        patch.status = input.status;
        statusChanged = true;
      }
      const after = (
        await tx.update(projects).set(patch).where(eq(projects.id, id)).returning()
      )[0]!;
      if (nameChanged || descChanged) {
        await writeChangeLog(tx, {
          entityType: 'project',
          entityId: id,
          changeType: 'update',
          before,
          after,
          actor,
        });
      }
      if (statusChanged) {
        await writeChangeLog(tx, {
          entityType: 'project',
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

  async getProject(id: string): Promise<ProjectSummary> {
    const project = (await this.db.select().from(projects).where(eq(projects.id, id)))[0];
    if (!project) throw new DomainError('NOT_FOUND', `项目 ${id} 不存在`);

    const reqs = await this.db.select().from(requirements).where(eq(requirements.projectId, id));
    const reqIds = reqs.map((r) => r.id);
    const points = reqIds.length
      ? await this.db
          .select()
          .from(requirementPoints)
          .where(inArray(requirementPoints.requirementId, reqIds))
      : [];

    const pointStatusCounts: Record<PointStatusKey, number> = {
      draft: 0,
      confirmed: 0,
      developing: 0,
      done: 0,
    };
    for (const pt of points) pointStatusCounts[pt.status] += 1;

    const entityIds = [id, ...reqIds, ...points.map((pt) => pt.id)];
    const recentChanges = entityIds.length
      ? await this.db
          .select()
          .from(changeLogs)
          .where(inArray(changeLogs.entityId, entityIds))
          .orderBy(desc(changeLogs.createdAt))
          .limit(20)
      : [];

    return {
      project,
      requirementTotal: reqs.length,
      requirementDone: reqs.filter((r) => r.status === 'done').length,
      overdueRequirementCount: reqs.filter((r) => computeOverdue(r).overdue).length,
      pointStatusCounts,
      recentChanges,
    };
  }

  async listProjects(filter?: { groupId?: string | null }): Promise<ProjectRow[]> {
    if (filter?.groupId === null) {
      return this.db.select().from(projects).where(isNull(projects.groupId));
    }
    if (filter?.groupId !== undefined) {
      return this.db.select().from(projects).where(eq(projects.groupId, filter.groupId));
    }
    return this.db.select().from(projects);
  }

  /**
   * 永久删除项目:单事务级联删除全部从属数据
   * (顺序:tasks → requirement_points → requirements → materials → analysis_runs → projects)。
   * change_logs 历史保留(审计核心,不删);同事务追加一条 delete 留痕,
   * before 为项目整行,after 为 { deleted, cascade } 统计。
   */
  async deleteProject(id: string, actor: Actor): Promise<DeleteProjectCascade> {
    return this.db.transaction(async (tx) => {
      const project = (await tx.select().from(projects).where(eq(projects.id, id)))[0];
      if (!project) throw new DomainError('NOT_FOUND', `项目 ${id} 不存在`);

      // 先收集 id 链(projectId → requirementIds → pointIds),供子表按 inArray 删除
      const reqs = await tx
        .select({ id: requirements.id })
        .from(requirements)
        .where(eq(requirements.projectId, id));
      const reqIds = reqs.map((r) => r.id);
      const pts = reqIds.length
        ? await tx
            .select({ id: requirementPoints.id })
            .from(requirementPoints)
            .where(inArray(requirementPoints.requirementId, reqIds))
        : [];
      const pointIds = pts.map((pt) => pt.id);

      const taskRows = pointIds.length
        ? await tx.delete(tasks).where(inArray(tasks.requirementPointId, pointIds)).returning()
        : [];
      const pointRows = reqIds.length
        ? await tx
            .delete(requirementPoints)
            .where(inArray(requirementPoints.requirementId, reqIds))
            .returning()
        : [];
      const reqRows = reqIds.length
        ? await tx.delete(requirements).where(inArray(requirements.id, reqIds)).returning()
        : [];
      const materialRows = await tx
        .delete(materials)
        .where(eq(materials.projectId, id))
        .returning();
      const runRows = await tx
        .delete(analysisRuns)
        .where(eq(analysisRuns.projectId, id))
        .returning();
      await tx.delete(projects).where(eq(projects.id, id));

      const cascade: DeleteProjectCascade = {
        requirements: reqRows.length,
        points: pointRows.length,
        tasks: taskRows.length,
        runs: runRows.length,
        materials: materialRows.length,
      };
      await writeChangeLog(tx, {
        entityType: 'project',
        entityId: id,
        changeType: 'delete',
        before: project,
        after: { deleted: true, cascade },
        reason: '删除项目(级联)',
        actor,
      });
      return cascade;
    });
  }
}
