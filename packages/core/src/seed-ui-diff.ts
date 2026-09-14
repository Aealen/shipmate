/**
 * UI 对照演示数据(临时,ui-diff 任务专用,用完即删)
 * 运行:pnpm -C packages/core exec tsx src/seed-ui-diff.ts
 * 清理:pnpm -C packages/core exec tsx src/seed-ui-diff.ts --clean
 */
import { eq } from 'drizzle-orm';
import { loadDotEnv, createDatabase, createCore } from './index.js';
import type { AnalysisResult } from './llm/schema.js';
import type { LlmInvoker } from './services/analysis.service.js';
import { analysisRuns, requirementPoints } from './db/schema.js';
import { newId } from './db/id.js';

const human = 'human' as const;

async function clean(): Promise<void> {
  loadDotEnv();
  const db = await createDatabase(process.env.SHIPMATE_DATABASE_URL!);
  const core = createCore(db);
  const groups = await core.groups.listGroups();
  const demoGroups = groups.filter((g) => g.name.startsWith('演示-'));
  for (const g of demoGroups) {
    const projects = await core.projects.listProjects({ groupId: g.id });
    for (const p of projects) {
      await core.projects.updateProject(p.id, { status: 'archived' }, human).catch(() => {});
    }
  }
  const all = await core.projects.listProjects({});
  for (const p of all.filter((p) => p.name.startsWith('演示-'))) {
    await core.projects.updateProject(p.id, { status: 'archived' }, human).catch(() => {});
  }
  console.log('cleaned demo groups:', demoGroups.length);
  process.exit(0);
}

async function main(): Promise<void> {
  if (process.argv.includes('--clean')) return clean();
  loadDotEnv();
  const db = await createDatabase(process.env.SHIPMATE_DATABASE_URL!);
  const core = createCore(db);
  const now = Date.now();
  const day = 86_400_000;

  // ── 分组 ──
  const g1 = await core.groups.createGroup({ name: '演示-华信 · 智慧投标' }, human);
  const g2 = await core.groups.createGroup({ name: '演示-Maxon 实验室' }, human);

  // ── 项目 A:智慧投标平台(数据丰满:各状态点/任务/超期/批次) ──
  const pa = await core.projects.createProject(
    {
      groupId: g1.id,
      name: '演示-智慧投标平台',
      description: '投标全流程管理:招标解析、标书协作、开标跟踪',
    },
    human,
  );

  const reqDefs = [
    { title: '素材分析与需求提炼', priority: 'P1' as const, planDueAt: now - 6 * day },
    { title: '标书协作编辑', priority: 'P2' as const, planDueAt: now + 10 * day },
    { title: '开标倒计时看板', priority: 'P3' as const, planDueAt: now + 20 * day },
    { title: '招标文件智能解析', priority: 'P0' as const, planDueAt: undefined },
  ];
  const createdReqs = [];
  for (const r of reqDefs) {
    createdReqs.push(await core.requirements.createRequirement({ projectId: pa.id, ...r }, human));
  }
  const pointDefs: Array<{
    req: number;
    title: string;
    status: 'draft' | 'confirmed' | 'developing' | 'done';
  }> = [
    { req: 0, title: '结构化输出强制 JSON schema', status: 'done' },
    { req: 0, title: 'draft 态不自动确认', status: 'done' },
    { req: 0, title: '冲突三分类裁决', status: 'confirmed' },
    { req: 0, title: '原文依据溯源展示', status: 'draft' },
    { req: 1, title: '多人实时协同锁', status: 'developing' },
    { req: 1, title: '章节模板库', status: 'draft' },
    { req: 2, title: '开标倒计时看板', status: 'draft' },
    { req: 3, title: '招标文件格式识别', status: 'confirmed' },
  ];
  const createdPoints = [];
  for (const d of pointDefs) {
    const pt = (
      await db
        .insert(requirementPoints)
        .values({
          id: newId(),
          requirementId: createdReqs[d.req]!.id,
          title: d.title,
          description: '演示数据:用于 UI 对照',
          status: d.status,
          version: 1,
          sourceMaterialIds: [],
          evidences: [],
          origin: 'manual',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    createdPoints.push(pt);
  }
  // ── 任务:pending/in_progress/done/needs_reassessment ──
  const t1 = await core.tasks.createTask(
    { requirementPointId: createdPoints[0]!.id, title: '实现 JSON schema 校验器' },
    human,
  );
  await core.tasks.setTaskStatus(t1.id, 'start', human);
  await core.tasks.setTaskStatus(t1.id, 'complete', human);
  const t2 = await core.tasks.createTask(
    { requirementPointId: createdPoints[4]!.id, title: '协同锁服务实现' },
    human,
  );
  await core.tasks.setTaskStatus(t2.id, 'start', human);
  await core.tasks.createTask(
    { requirementPointId: createdPoints[2]!.id, title: '裁决交互原型' },
    human,
  );
  await core.points.updateRequirementPoint(
    createdPoints[0]!.id,
    { title: '结构化输出强制 JSON Schema(含引用校验)', reason: '客户要求增加引用校验' },
    human,
  );
  const t4 = await core.tasks.createTask(
    { requirementPointId: createdPoints[7]!.id, title: '格式识别规则引擎' },
    human,
  );
  await core.tasks.setTaskStatus(t4.id, 'start', human);
  await core.points.updateRequirementPoint(
    createdPoints[7]!.id,
    { title: '招标文件格式识别(pdf/zip)', reason: '支持压缩包标书' },
    human,
  );

  // ── 分析批次:done / failed / pending ──
  const runDone = await core.analysis.createAnalysisRun(
    { projectId: pa.id, title: '群聊记录 + 运营反馈' },
    human,
  );
  const mat1 = await core.analysis.addMaterial(
    {
      runId: runDone.id,
      type: 'paste_text',
      title: '产品群聊记录',
      rawContent: '希望支持导出与定时提醒',
    },
    human,
  );
  await core.analysis.addMaterial(
    {
      runId: runDone.id,
      type: 'paste_text',
      title: '运营反馈汇总',
      rawContent: '周报需要自动汇总',
    },
    human,
  );
  const runFail = await core.analysis.createAnalysisRun(
    { projectId: pa.id, title: '基线检查报告' },
    human,
  );
  await core.analysis.addMaterial(
    {
      runId: runFail.id,
      type: 'screenshot_text',
      title: '基线检查报告截图',
      rawContent: '(截图内容)',
    },
    human,
  );
  const runPending = await core.analysis.createAnalysisRun(
    { projectId: pa.id, title: '竞品功能对比' },
    human,
  );
  await core.analysis.addMaterial(
    {
      runId: runPending.id,
      type: 'paste_text',
      title: '竞品对比笔记',
      rawContent: '对比维度:解析/协作/跟踪',
    },
    human,
  );
  const demoLlm: LlmInvoker = async () =>
    ({
      requirements: [
        {
          title: '报表导出增强',
          summary: '',
          module: '',
          points: [
            {
              title: '导出 CSV 格式',
              description: '',
              confidence: 0.9,
              evidences: [{ material_id: mat1.id, quote: '支持导出' }],
            },
            {
              title: '定时提醒',
              description: '',
              confidence: 0.8,
              evidences: [{ material_id: mat1.id, quote: '定时提醒' }],
            },
          ],
        },
      ],
      supplements: [],
    }) satisfies AnalysisResult;
  const { AnalysisService } = await import('./services/analysis.service.js');
  const demoAnalysis = new AnalysisService(db, demoLlm);
  await demoAnalysis.startAnalysis(runDone.id, 'ai:analysis');
  await db
    .update(analysisRuns)
    .set({ status: 'failed', completedAt: now })
    .where(eq(analysisRuns.id, runFail.id));

  // ── 项目 B:移动端采集 App(轻量:1 需求 3 点 draft + 1 批次 done) ──
  const pb = await core.projects.createProject(
    { groupId: g2.id, name: '演示-移动端采集 App', description: '外勤数据采集与离线同步' },
    human,
  );
  await core.requirements.createRequirement(
    {
      projectId: pb.id,
      title: '离线采集与同步',
      priority: 'P2' as const,
      planDueAt: now + 2 * day,
    },
    human,
  );
  const reqB = (await core.requirements.listRequirements(pb.id))[0]!;
  for (const title of ['离线包管理', '冲突合并策略', '信号弱重试']) {
    await db.insert(requirementPoints).values({
      id: newId(),
      requirementId: reqB.id,
      title,
      status: 'draft',
      version: 1,
      sourceMaterialIds: [],
      evidences: [],
      origin: 'manual',
      createdAt: now,
      updatedAt: now,
    });
  }
  const runB = await core.analysis.createAnalysisRun(
    { projectId: pb.id, title: '客户调研纪要' },
    human,
  );
  const matB = await core.analysis.addMaterial(
    { runId: runB.id, type: 'paste_text', title: '调研纪要 09-08', rawContent: '外勤需要离线采集' },
    human,
  );
  const llmB: LlmInvoker = async () =>
    ({
      requirements: [
        {
          title: '离线采集',
          summary: '',
          module: '',
          points: [
            {
              title: '离线包管理',
              description: '',
              confidence: 0.7,
              evidences: [{ material_id: matB.id, quote: '离线采集' }],
            },
          ],
        },
      ],
      supplements: [],
    }) satisfies AnalysisResult;
  const demoB = new AnalysisService(db, llmB);
  await demoB.startAnalysis(runB.id, 'ai:analysis');

  // ── 未分组演示项目 ──
  await core.projects.createProject(
    { name: '演示-官网重构', description: '品牌站与文档站改版' },
    human,
  );

  console.log('seeded: groups=2, projects=3');
  process.exit(0);
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error('seed failed:', e);
    process.exit(1);
  },
);
