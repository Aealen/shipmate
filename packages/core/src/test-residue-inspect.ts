import { loadDotEnv, createDatabase, schema } from './index.js';

async function main(): Promise<void> {
  loadDotEnv();
  const db = await createDatabase(process.env.SHIPMATE_TEST_DATABASE_URL!);
  const logs = await db.select().from(schema.changeLogs);
  for (const r of logs) {
    console.log(
      r.entityType,
      r.entityId.slice(0, 24),
      r.changeType,
      (r.reason ?? '').slice(0, 40),
      new Date(r.createdAt).toISOString(),
    );
  }
  const counts = [
    ['projects', schema.projects],
    ['groups', schema.groups],
    ['requirements', schema.requirements],
    ['requirement_points', schema.requirementPoints],
    ['tasks', schema.tasks],
    ['analysis_runs', schema.analysisRuns],
    ['materials', schema.materials],
  ] as const;
  for (const [name, t] of counts) {
    const rows = await db.select().from(t);
    console.log(`${name}: ${rows.length} 行`);
    for (const r of rows)
      console.log(
        '   ',
        (r as { id: string }).id.slice(0, 24),
        String(
          (r as { title?: string; name?: string }).title ?? (r as { name?: string }).name ?? '',
        ).slice(0, 30),
      );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
