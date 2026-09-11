/** 清理测试固定短 id 的提交残留:pnpm -C packages/core exec tsx src/test-residue-cleanup.ts */
import { loadDotEnv, createDatabase, schema } from './index.js';
import { eq } from 'drizzle-orm';

async function main(): Promise<void> {
  loadDotEnv();
  const db = await createDatabase(process.env.SHIPMATE_TEST_DATABASE_URL!);
  const logs = await db.select().from(schema.changeLogs);
  const counts = new Map<string, number>();
  for (const r of logs) counts.set(r.entityId, (counts.get(r.entityId) ?? 0) + 1);
  const shortIds = [...counts.keys()].filter((k) => k.length < 30);
  console.log(`change_logs 总 ${logs.length} 条;短 id:${JSON.stringify(shortIds)}`);

  for (const id of shortIds) await db.delete(schema.changeLogs).where(eq(schema.changeLogs.entityId, id));

  const tables = [
    ['projects', schema.projects],
    ['groups', schema.groups],
    ['requirements', schema.requirements],
    ['requirement_points', schema.requirementPoints],
    ['tasks', schema.tasks],
    ['analysis_runs', schema.analysisRuns],
    ['materials', schema.materials],
  ] as const;
  for (const [name, t] of tables) {
    const rows = await db.select().from(t);
    const bad = rows.filter((r) => r.id.length < 30);
    for (const r of bad) await db.delete(t).where(eq(t.id, r.id));
    if (bad.length) console.log(`清理 ${name}: ${bad.length} 行`);
  }
  console.log('done');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
