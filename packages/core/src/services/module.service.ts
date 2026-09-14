import { and, eq, ne, sql } from 'drizzle-orm';
import type { ShipmateDb, ShipmateTx } from '../db/database.js';
import {
  modules,
  projects,
  requirementPoints,
  requirements,
  type ModuleRow,
} from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';

export interface CreateModuleInput {
  projectId: string;
  name: string;
  description?: string;
}

export interface UpdateModuleInput {
  name?: string;
  description?: string;
  sortOrder?: number;
}

/** 模块列表项:行数据 + 需求/需求点就绪统计(spec §6 listModules) */
export type ModuleSummary = ModuleRow & {
  requirementCount: number;
  pointsDone: number;
  pointsTotal: number;
};

/** 模块删除转未归类时,逐需求 update 变更的固定 reason(spec D8) */
const UNTAGGED_REASON = '模块删除转未归类';

/** spec §3.9 模块:项目内的需求分类维度,纯分组无状态 */
export class ModuleService {
  constructor(private db: ShipmateDb) {}

  async createModule(input: CreateModuleInput, actor: Actor): Promise<ModuleRow> {
    const name = input.name?.trim();
    if (!name) throw new DomainError('VALIDATION_ERROR', '模块名不能为空');
    return this.db.transaction(async (tx) => {
      // 存在性检查须取首行判空:drizzle select 返回数组,空数组为 truthy,不能直接取反
      const project = (await tx.select().from(projects).where(eq(projects.id, input.projectId)))[0];
      if (!project) throw new DomainError('NOT_FOUND', `项目 ${input.projectId} 不存在`);
      await assertNameFree(tx, input.projectId, name);
      const now = Date.now();
      const rows = await tx
        .insert(modules)
        .values({
          id: newId(),
          projectId: input.projectId,
          name,
          description: input.description ?? null,
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'module',
        entityId: row.id,
        changeType: 'create',
        after: row,
        actor,
      });
      return row;
    });
  }

  async updateModule(id: string, input: UpdateModuleInput, actor: Actor): Promise<ModuleRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(modules).where(eq(modules.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `模块 ${id} 不存在`);
      const name = input.name?.trim() || before.name;
      if (name !== before.name) await assertNameFree(tx, before.projectId, name, id);
      const rows = await tx
        .update(modules)
        .set({
          name,
          description: input.description !== undefined ? input.description : before.description,
          sortOrder: input.sortOrder !== undefined ? input.sortOrder : before.sortOrder,
          updatedAt: Date.now(),
        })
        .where(eq(modules.id, id))
        .returning();
      const after = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'module',
        entityId: id,
        changeType: 'update',
        before,
        after,
        actor,
      });
      return after;
    });
  }

  /** 删除模块(spec D8):其下需求 moduleId 置 null(转未归类),需求本身不动 */
  async deleteModule(id: string, actor: Actor): Promise<void> {
    await this.db.transaction(async (tx) => {
      const before = (await tx.select().from(modules).where(eq(modules.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `模块 ${id} 不存在`);
      const owned = await tx.select().from(requirements).where(eq(requirements.moduleId, id));
      for (const req of owned) {
        const after = (
          await tx
            .update(requirements)
            .set({ moduleId: null, updatedAt: Date.now() })
            .where(eq(requirements.id, req.id))
            .returning()
        )[0]!;
        await writeChangeLog(tx, {
          entityType: 'requirement',
          entityId: req.id,
          changeType: 'update',
          before: req,
          after,
          reason: UNTAGGED_REASON,
          actor,
        });
      }
      await tx.delete(modules).where(eq(modules.id, id));
      await writeChangeLog(tx, {
        entityType: 'module',
        entityId: id,
        changeType: 'delete',
        before,
        after: { deleted: true, id },
        actor,
      });
    });
  }

  /**
   * 项目内模块列表(组序 sortOrder→name),附需求统计:
   * 两条聚合查询——requirements 按 module_id 计数;requirement_points join requirements 按 module 聚合 done/total。
   * count 以 bigint 返回会被 pg 驱动转 string,统一 cast 成 int 保证 number。
   */
  async listModules(projectId: string): Promise<ModuleSummary[]> {
    const rows = await this.db
      .select()
      .from(modules)
      .where(eq(modules.projectId, projectId))
      .orderBy(modules.sortOrder, modules.name);
    const [reqCounts, pointStats] = await Promise.all([
      this.db
        .select({ moduleId: requirements.moduleId, count: sql<number>`cast(count(*) as int)` })
        .from(requirements)
        .where(eq(requirements.projectId, projectId))
        .groupBy(requirements.moduleId),
      this.db
        .select({
          moduleId: requirements.moduleId,
          done: sql<number>`cast(count(*) filter (where ${requirementPoints.status} = 'done') as int)`,
          total: sql<number>`cast(count(*) as int)`,
        })
        .from(requirementPoints)
        .innerJoin(requirements, eq(requirementPoints.requirementId, requirements.id))
        .where(eq(requirements.projectId, projectId))
        .groupBy(requirements.moduleId),
    ]);
    const countMap = new Map(reqCounts.map((r) => [r.moduleId, r.count]));
    const statMap = new Map(pointStats.map((r) => [r.moduleId, r]));
    return rows.map((m) => ({
      ...m,
      requirementCount: countMap.get(m.id) ?? 0,
      pointsDone: statMap.get(m.id)?.done ?? 0,
      pointsTotal: statMap.get(m.id)?.total ?? 0,
    }));
  }
}

/** 同项目内模块名唯一(spec §3.9);excludeId 用于改名时排除自身 */
async function assertNameFree(
  tx: ShipmateTx,
  projectId: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  const conds = [eq(modules.projectId, projectId), eq(modules.name, name)];
  if (excludeId) conds.push(ne(modules.id, excludeId));
  const dup = (
    await tx
      .select()
      .from(modules)
      .where(and(...conds))
  )[0];
  if (dup) throw new DomainError('MODULE_NAME_TAKEN', `模块名「${name}」在项目内已存在`);
}
