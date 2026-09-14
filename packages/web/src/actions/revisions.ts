'use server';

import { and, desc, eq, inArray, or } from 'drizzle-orm';
import {
  changeLogs,
  requirementPoints,
  requirements,
  type ChangeLogRow,
} from '@shipmate/core';
import { getShipmate } from '@/lib/core';

/**
 * 修订历史数据层(P3g 点行就地下拉 / P3j 块修订历史 Modal)。
 *
 * AI 修订经 core 结转写 changeType='revision':批注在 reason(同 after 快照的
 * annotation),移除需求点的条目挂块上、after 快照带 removedPointTitle
 * (analysis.service applyAnalysisRun 结转逻辑)。人工实质修改仍写 'update',
 * 一并纳入历史(兼容查询 ['revision','update'];类型断言绕过编译期枚举联合,
 * SQL 层为 text 列无约束)。
 */

/** 单条修订条目(轻量形状,jsonb 快照等重字段不出服务端) */
export interface RevisionEntry {
  id: string;
  /** 批注/修订说明;reason 为空时为 '',由 UI 显示兜底文案 */
  annotation: string;
  actor: string;
  at: number;
  /** 该条目导致移除的需求点标题(仅块级修订可能携带) */
  removedPointTitle?: string;
}

/** 单个需求点的修订分组(块 Modal 内容区) */
export interface PointRevisionGroup {
  id: string;
  title: string;
  entries: RevisionEntry[];
}

/** 块级修订历史全量(Modal 打开时拉取) */
export interface RequirementRevisionHistory {
  /** 块自身条目(含 removedPointTitle 条目,UI 负责拆分为块组/移除组) */
  block: RevisionEntry[];
  /** 各需求点分组(无修订的点 entries 为空数组) */
  points: PointRevisionGroup[];
  /** 块上带 removedPointTitle 的条目(block 的子集) */
  removed: RevisionEntry[];
}

/** 修订历史只取 AI 修订结转的专用类型(人工/系统 update 走 P4 详情页时间线) */
const REV_CHANGE_TYPES: ChangeLogRow['changeType'][] = ['revision'];

/** 移除需求点的修订:core 结转时把 removedPointTitle 放在 after 快照顶层 */
function extractRemovedPointTitle(after: unknown): string | undefined {
  if (!after || typeof after !== 'object') return undefined;
  const title = (after as { removedPointTitle?: unknown }).removedPointTitle;
  return typeof title === 'string' && title ? title : undefined;
}

function toEntry(row: ChangeLogRow): RevisionEntry {
  const removedPointTitle = extractRemovedPointTitle(row.afterSnapshot);
  return {
    id: row.id,
    annotation: row.reason ?? '',
    actor: row.actor,
    at: row.createdAt,
    ...(removedPointTitle !== undefined ? { removedPointTitle } : {}),
  };
}

/** 块级修订历史全量(块自身 + 各点 + 移除条目),条目按时间倒序 */
export async function getRequirementRevisionHistory(
  requirementId: string,
): Promise<RequirementRevisionHistory> {
  const { db } = await getShipmate();
  const blockRow = (
    await db.select().from(requirements).where(eq(requirements.id, requirementId))
  )[0];
  if (!blockRow) return { block: [], points: [], removed: [] };

  const pointRows = await db
    .select()
    .from(requirementPoints)
    .where(eq(requirementPoints.requirementId, requirementId));

  const scope = pointRows.length
    ? or(
        and(eq(changeLogs.entityType, 'requirement'), eq(changeLogs.entityId, requirementId)),
        and(
          eq(changeLogs.entityType, 'requirement_point'),
          inArray(
            changeLogs.entityId,
            pointRows.map((p) => p.id),
          ),
        ),
      )
    : and(eq(changeLogs.entityType, 'requirement'), eq(changeLogs.entityId, requirementId));

  const rows = await db
    .select()
    .from(changeLogs)
    .where(and(inArray(changeLogs.changeType, REV_CHANGE_TYPES), scope))
    .orderBy(desc(changeLogs.createdAt));

  const block: RevisionEntry[] = [];
  const byPoint = new Map<string, RevisionEntry[]>();
  for (const row of rows) {
    const entry = toEntry(row);
    if (row.entityType === 'requirement' && row.entityId === requirementId) {
      block.push(entry);
    } else if (row.entityType === 'requirement_point') {
      const list = byPoint.get(row.entityId);
      if (list) list.push(entry);
      else byPoint.set(row.entityId, [entry]);
    }
  }

  return {
    block,
    points: pointRows.map((p) => ({
      id: p.id,
      title: p.title,
      entries: byPoint.get(p.id) ?? [],
    })),
    removed: block.filter((e) => e.removedPointTitle !== undefined),
  };
}

/** 点行就地下拉:单个需求点的修订条目(时间倒序) */
export async function getPointRevisionHistory(pointId: string): Promise<RevisionEntry[]> {
  const { db } = await getShipmate();
  const rows = await db
    .select()
    .from(changeLogs)
    .where(
      and(
        eq(changeLogs.entityType, 'requirement_point'),
        eq(changeLogs.entityId, pointId),
        inArray(changeLogs.changeType, REV_CHANGE_TYPES),
      ),
    )
    .orderBy(desc(changeLogs.createdAt));
  return rows.map(toEntry);
}

/** P3 列表 ✨N 徽标:块与点的修订计数(轻量选列查询,不拉 jsonb 快照) */
export async function listRequirementRevisionCounts(
  requirementIds: string[],
  pointIds: string[],
): Promise<Record<string, number>> {
  if (requirementIds.length === 0 && pointIds.length === 0) return {};
  const { db } = await getShipmate();
  const rows = await db
    .select({ entityId: changeLogs.entityId })
    .from(changeLogs)
    .where(
      and(
        inArray(changeLogs.entityType, ['requirement', 'requirement_point']),
        inArray(changeLogs.entityId, [...requirementIds, ...pointIds]),
        inArray(changeLogs.changeType, REV_CHANGE_TYPES),
      ),
    );
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.entityId] = (counts[row.entityId] ?? 0) + 1;
  return counts;
}
