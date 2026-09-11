import { desc, eq, inArray } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import {
  analysisRuns,
  changeLogs,
  materials,
  projects,
  requirementPoints,
  requirements,
  tasks,
  type ChangeLogRow,
} from '../db/schema.js';
import { DomainError } from '../errors.js';

export type ActorKind = 'human' | 'ai' | 'mcp';

export interface AuditReport {
  timeline: ChangeLogRow[];
  actorDistribution: Record<ActorKind, number>;
  entityTypeDistribution: Record<string, number>;
  dailyCounts: { date: string; count: number }[];
}

function actorKind(actor: string): ActorKind {
  if (actor === 'human') return 'human';
  if (actor.startsWith('mcp:')) return 'mcp';
  return 'ai';
}

function localDate(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export class AuditService {
  constructor(private db: ShipmateDb) {}

  async getChangeLog(filter: {
    entityType: ChangeLogRow['entityType'];
    entityId: string;
    limit?: number;
  }): Promise<ChangeLogRow[]> {
    const rows = await this.db
      .select()
      .from(changeLogs)
      .where(eq(changeLogs.entityId, filter.entityId))
      .orderBy(desc(changeLogs.createdAt))
      .limit(filter.limit ?? 100);
    return rows.filter((r) => r.entityType === filter.entityType);
  }

  async getProjectAuditReport(projectId: string): Promise<AuditReport> {
    const project = (await this.db.select().from(projects).where(eq(projects.id, projectId)))[0];
    if (!project) throw new DomainError('NOT_FOUND', `项目 ${projectId} 不存在`);

    const reqs = await this.db
      .select()
      .from(requirements)
      .where(eq(requirements.projectId, projectId));
    const reqIds = reqs.map((r) => r.id);
    const points = reqIds.length
      ? await this.db
          .select()
          .from(requirementPoints)
          .where(inArray(requirementPoints.requirementId, reqIds))
      : [];
    const pointIds = points.map((p) => p.id);
    const pointTasks = pointIds.length
      ? await this.db.select().from(tasks).where(inArray(tasks.requirementPointId, pointIds))
      : [];
    const runs = await this.db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.projectId, projectId));
    const mats = await this.db.select().from(materials).where(eq(materials.projectId, projectId));

    const entityIds = [
      projectId,
      ...reqIds,
      ...pointIds,
      ...pointTasks.map((t) => t.id),
      ...runs.map((r) => r.id),
      ...mats.map((m) => m.id),
    ];
    const timeline = entityIds.length
      ? await this.db
          .select()
          .from(changeLogs)
          .where(inArray(changeLogs.entityId, entityIds))
          .orderBy(desc(changeLogs.createdAt))
          .limit(500)
      : [];

    const actorDistribution: Record<ActorKind, number> = { human: 0, ai: 0, mcp: 0 };
    const entityTypeDistribution: Record<string, number> = {};
    const daily = new Map<string, number>();
    for (const log of timeline) {
      actorDistribution[actorKind(log.actor)] += 1;
      entityTypeDistribution[log.entityType] = (entityTypeDistribution[log.entityType] ?? 0) + 1;
      const day = localDate(log.createdAt);
      daily.set(day, (daily.get(day) ?? 0) + 1);
    }
    const dailyCounts = [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    return { timeline, actorDistribution, entityTypeDistribution, dailyCounts };
  }
}
