/**
 * ShipMate core 演示脚本(终端可视化)
 * 运行:pnpm -C packages/core exec tsx src/demo.ts
 * 数据写入真实 PostgreSQL(与测试同库),演示数据带「DEMO-」前缀便于辨认
 */
import { loadDotEnv, createDatabase, createCore } from './index.js';
import type { AnalysisResult } from './llm/schema.js';
import type { LlmInvoker } from './services/analysis.service.js';

function banner(title: string): void {
  console.log(`\n${'═'.repeat(62)}\n  ${title}\n${'═'.repeat(62)}`);
}

function row(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(24, ' ')}${String(value)}`);
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.SHIPMATE_DATABASE_URL;
  if (!url) throw new Error('缺少 SHIPMATE_DATABASE_URL(见仓库根 .env)');
  const db = await createDatabase(url);
  const core = createCore(db);
  const human = 'human' as const;

  banner('① 分组与项目(Group → Project)');
  const group = await core.groups.createGroup({ name: 'DEMO-华信事业部' }, human);
  row('分组', `${group.name}(${group.id.slice(0, 8)}…)`);
  const project = await core.projects.createProject(
    { groupId: group.id, name: 'DEMO-报表中心', description: '演示:需求全生命周期' },
    human,
  );
  row('项目', `${project.name}(status=${project.status})`);

  banner('② 需求与需求点(Requirement → RequirementPoint)');
  const req = await core.requirements.createRequirement(
    {
      projectId: project.id,
      title: '报表导出功能',
      summary: '多格式导出',
      priority: 'P1',
      planDueAt: Date.now() - 2 * 86_400_000,
    },
    human,
  );
  row('需求', `${req.title}(priority=${req.priority}, 已设 2 天前截止 → 应判超期)`);
  const point1 = await core.points.listRequirementPoints({ requirementId: req.id });
  void point1;
  // 手工建需求点:建点走 analysis.service?不——演示用 insert;core 无 createPoint 门面,用 AI 批次或 SQL。
  // 改用分析批次产点(见 ④),此处直接建任务前先造一个点:
  const now = Date.now();
  const { requirementPoints } = await import('./db/schema.js');
  const { newId } = await import('./db/id.js');
  const pt1 = (
    await db
      .insert(requirementPoints)
      .values({
        id: newId(),
        requirementId: req.id,
        title: '支持 CSV 导出',
        status: 'draft',
        version: 1,
        sourceMaterialIds: [],
        evidences: [],
        origin: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;
  row('需求点', `${pt1.title}(status=draft, v${pt1.version})`);

  banner('③ 状态机与实质修改联动(spec §4.1/§5.3)');
  await core.points.confirmRequirementPoint(pt1.id, human);
  const developing = await core.points.setRequirementPointStatus(pt1.id, 'start', human);
  row('状态流转', `draft → confirmed → ${developing.status}`);
  const task = await core.tasks.createTask(
    { requirementPointId: pt1.id, title: '实现 CSV 导出器' },
    human,
  );
  await core.tasks.setTaskStatus(task.id, 'start', human);
  row('开发任务', `${task.title} → in_progress`);
  const linkage = await core.points.updateRequirementPoint(
    pt1.id,
    { title: '支持 CSV/Excel 双格式导出', reason: '客户要求增加 Excel' },
    human,
  );
  row(
    '实质修改',
    `「${linkage.point.title}」version→${linkage.point.version}, 状态→${linkage.point.status}`,
  );
  row('任务联动', `受影响 ${linkage.affectedTaskCount} 个任务 → needs_reassessment`);
  const reassessed = await core.tasks.confirmTaskReassessment(task.id, human);
  row('重估确认', `任务回到 ${reassessed.status}(spec §4.2)`);

  banner('④ AI 素材分析批次(spec §9,LLM 产出为演示注入)');
  const run = await core.analysis.createAnalysisRun(
    { projectId: project.id, title: '演示批次:客户会议记录' },
    human,
  );
  const mat = await core.analysis.addMaterial(
    {
      runId: run.id,
      type: 'paste_text',
      title: '会议记录',
      rawContent: '客户要求:报表支持导出 CSV;另外希望有定时邮件推送报表。',
    },
    human,
  );
  row('素材', `${mat.title}(${mat.type},${mat.rawContent.length} 字)`);
  const demoDraft: AnalysisResult = {
    requirements: [
      {
        title: '报表导出功能', // 与已有需求同名 → LLM 标注重复
        summary: '',
        conflict: {
          type: 'duplicate',
          target_requirement_title: '报表导出功能',
          reason: '与已有需求同口径',
        },
        points: [
          {
            title: '支持 CSV 导出',
            description: '',
            confidence: 0.92,
            evidences: [{ material_id: mat.id, quote: '报表支持导出 CSV' }],
          },
        ],
      },
      {
        title: '报表定时推送',
        summary: '定时邮件推送报表',
        points: [
          {
            title: '每日定时邮件推送',
            description: '',
            confidence: 0.85,
            evidences: [{ material_id: mat.id, quote: '定时邮件推送报表' }],
          },
        ],
      },
    ],
    supplements: [],
  };
  // 演示注入:跳过真实 LLM(生产由 createAnalysisService + settings 表的模型配置驱动)
  const demoLlm: LlmInvoker = async () => demoDraft;
  const { AnalysisService } = await import('./services/analysis.service.js');
  const demoAnalysis = new AnalysisService(db, demoLlm);
  await demoAnalysis.startAnalysis(run.id, 'ai:analysis');
  row('分析完成', `run.status=done,草稿 ${demoDraft.requirements.length} 块(1 重复 + 1 全新)`);
  const created = await demoAnalysis.applyAnalysisRun(run.id, undefined, human);
  row(
    '应用落库',
    `新建需求 ${created.length} 个:「${created.map((r) => r.title).join('」「')}」(均 draft 态,spec §5.4)`,
  );
  const merged = (await core.requirements.listRequirements(project.id)).find(
    (r) => r.title === '报表导出功能',
  );
  const mergedPoints = merged
    ? await core.points.listRequirementPoints({ requirementId: merged.id })
    : [];
  const csvPoint = mergedPoints.find((p) => p.title === '支持 CSV 导出');
  row(
    '重复块并入',
    `已有需求「报表导出功能」的点 evidences 追加至 ${csvPoint?.evidences?.length ?? 0} 条(含原文引用)`,
  );

  banner('⑤ 概览与审计(spec §6 ProjectSummary / AuditReport)');
  const summary = await core.projects.getProject(project.id);
  row('需求完成度', `${summary.requirementDone}/${summary.requirementTotal}`);
  row('超期需求数', summary.overdueRequirementCount);
  row('需求点状态分布', JSON.stringify(summary.pointStatusCounts));
  const report = await core.audit.getProjectAuditReport(project.id);
  row('变更时间线', `${report.timeline.length} 条`);
  row('actor 分布', JSON.stringify(report.actorDistribution));
  row('日变更计数', report.dailyCounts.map((d) => `${d.date}:${d.count}`).join('  '));
  console.log('\n  最近 6 条变更:');
  for (const log of report.timeline.slice(0, 6)) {
    console.log(
      `   · [${log.changeType.padEnd(14)}] ${log.entityType.padEnd(17)} ${log.reason ?? ''} (by ${log.actor})`,
    );
  }

  banner('演示结束——以上数据在 PostgreSQL 真库,Web UI(Plan 3)将把这些变成界面');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('演示失败:', e);
    process.exit(1);
  });
