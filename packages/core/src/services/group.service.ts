import { eq } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import { groups, projects, requirements, type GroupRow, type ProjectRow } from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';

export interface CreateGroupInput {
  name: string;
  description?: string;
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
  sortOrder?: number;
}

export type GroupWithCount = GroupRow & { projectCount: number };

export interface GroupProjectSummary {
  project: ProjectRow;
  requirementTotal: number;
  requirementDone: number;
}

export interface GroupSummary {
  group: GroupRow;
  projects: GroupProjectSummary[];
}

export class GroupService {
  constructor(private db: ShipmateDb) {}

  async createGroup(input: CreateGroupInput, actor: Actor): Promise<GroupRow> {
    const name = input.name?.trim();
    if (!name) throw new DomainError('VALIDATION_ERROR', '分组名不能为空');
    return this.db.transaction(async (tx) => {
      const now = Date.now();
      const rows = await tx
        .insert(groups)
        .values({
          id: newId(),
          name,
          description: input.description ?? null,
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'group',
        entityId: row.id,
        changeType: 'create',
        after: row,
        actor,
      });
      return row;
    });
  }

  async updateGroup(id: string, input: UpdateGroupInput, actor: Actor): Promise<GroupRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(groups).where(eq(groups.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `分组 ${id} 不存在`);
      const rows = await tx
        .update(groups)
        .set({
          name: input.name?.trim() || before.name,
          description: input.description !== undefined ? input.description : before.description,
          sortOrder: input.sortOrder !== undefined ? input.sortOrder : before.sortOrder,
          updatedAt: Date.now(),
        })
        .where(eq(groups.id, id))
        .returning();
      const after = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'group',
        entityId: id,
        changeType: 'update',
        before,
        after,
        actor,
      });
      return after;
    });
  }

  async deleteGroup(id: string, actor: Actor): Promise<void> {
    await this.db.transaction(async (tx) => {
      const before = (await tx.select().from(groups).where(eq(groups.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `分组 ${id} 不存在`);
      const owned = await tx.select().from(projects).where(eq(projects.groupId, id));
      if (owned.length > 0) {
        throw new DomainError(
          'GROUP_NOT_EMPTY',
          `分组「${before.name}」下仍有 ${owned.length} 个项目,禁止删除`,
        );
      }
      await tx.delete(groups).where(eq(groups.id, id));
      await writeChangeLog(tx, {
        entityType: 'group',
        entityId: id,
        changeType: 'delete',
        before,
        after: { deleted: true, id },
        actor,
      });
    });
  }

  async getGroup(id: string): Promise<GroupSummary> {
    const group = (await this.db.select().from(groups).where(eq(groups.id, id)))[0];
    if (!group) throw new DomainError('NOT_FOUND', `分组 ${id} 不存在`);
    const projs = await this.db.select().from(projects).where(eq(projects.groupId, id));
    const projectSummaries = await Promise.all(
      projs.map(async (p) => {
        const reqs = await this.db
          .select()
          .from(requirements)
          .where(eq(requirements.projectId, p.id));
        return {
          project: p,
          requirementTotal: reqs.length,
          requirementDone: reqs.filter((r) => r.status === 'done').length,
        };
      }),
    );
    return { group, projects: projectSummaries };
  }

  async listGroups(): Promise<GroupWithCount[]> {
    const rows = await this.db.select().from(groups);
    const allProjects = await this.db.select().from(projects);
    return rows.map((g) => ({
      ...g,
      projectCount: allProjects.filter((p) => p.groupId === g.id).length,
    }));
  }
}
