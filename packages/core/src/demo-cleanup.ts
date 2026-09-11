/**
 * 清理演示残留数据(DEMO- 前缀):按外键依赖逆序删除
 * 运行:pnpm -C packages/core exec tsx src/demo-cleanup.ts
 */
import { loadDotEnv, createDatabase, schema } from './index.js';
import { eq, like, inArray } from 'drizzle-orm';

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.SHIPMATE_DATABASE_URL;
  if (!url) throw new Error('缺少 SHIPMATE_DATABASE_URL');
  const db = await createDatabase(url);

  const demoGroups = await db
    .select()
    .from(schema.groups)
    .where(like(schema.groups.name, 'DEMO-%'));
  const demoProjects = await db
    .select()
    .from(schema.projects)
    .where(like(schema.projects.name, 'DEMO-%'));
  const projectIds = demoProjects.map((p) => p.id);
  const groupIds = demoGroups.map((g) => g.id);
  console.log(`发现演示数据:${demoGroups.length} 组 / ${demoProjects.length} 项目`);

  if (projectIds.length > 0) {
    const reqs = await db
      .select()
      .from(schema.requirements)
      .where(inArray(schema.requirements.projectId, projectIds));
    const reqIds = reqs.map((r) => r.id);
    const points = reqIds.length
      ? await db
          .select()
          .from(schema.requirementPoints)
          .where(inArray(schema.requirementPoints.requirementId, reqIds))
      : [];
    const pointIds = points.map((p) => p.id);
    const pointTasks = pointIds.length
      ? await db
          .select()
          .from(schema.tasks)
          .where(inArray(schema.tasks.requirementPointId, pointIds))
      : [];
    const allEntityIds = [projectIds, reqIds, pointIds, pointTasks.map((t) => t.id)].flat();
    // 补充:分组、分析批次、素材的 create log entityId 不在上述实体链里
    const runIds = (
      await db.select().from(schema.analysisRuns).where(inArray(schema.analysisRuns.projectId, projectIds))
    ).map((r) => r.id);
    const matIds = (
      await db.select().from(schema.materials).where(inArray(schema.materials.projectId, projectIds))
    ).map((r) => r.id);
    allEntityIds.push(...groupIds, ...runIds, ...matIds);

    for (const id of pointTasks.map((t) => t.id))
      await db.delete(schema.tasks).where(eq(schema.tasks.id, id));
    for (const id of pointIds)
      await db.delete(schema.requirementPoints).where(eq(schema.requirementPoints.id, id));
    for (const id of reqIds)
      await db.delete(schema.requirements).where(eq(schema.requirements.id, id));
    for (const id of projectIds) {
      await db.delete(schema.materials).where(eq(schema.materials.projectId, id));
      await db.delete(schema.analysisRuns).where(eq(schema.analysisRuns.projectId, id));
    }
    // 审计日志:删这些实体的记录(change_logs 无外键)
    for (const id of allEntityIds)
      await db.delete(schema.changeLogs).where(eq(schema.changeLogs.entityId, id));
    for (const id of projectIds) await db.delete(schema.projects).where(eq(schema.projects.id, id));
  }
  for (const id of groupIds) await db.delete(schema.groups).where(eq(schema.groups.id, id));

  // 兜底:验证清干净
  const leftGroups = await db
    .select()
    .from(schema.groups)
    .where(like(schema.groups.name, 'DEMO-%'));
  const leftProjects = await db
    .select()
    .from(schema.projects)
    .where(like(schema.projects.name, 'DEMO-%'));
  console.log(`清理完成,残留:组 ${leftGroups.length} / 项目 ${leftProjects.length}(应为 0)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
