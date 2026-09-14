import { AnalysisBrowse, type RunCardData } from '@/components/analysis-browse/analysis-browse';
import { getShipmate } from '@/lib/core';
import { listRequirementRevisionCounts } from '@/actions/revisions';

/**
 * P3 需求分析页(Task 6,B 组,纯只读浏览):
 * 上半「素材分析记录」卡流 + 下半「需求列表」。数据不经 actions,
 * 服务端直调 core 单例取数;写操作归 P3c 工作台(C 组)与详情页。
 */
export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { core } = await getShipmate();

  const [runs, requirements, points, modules] = await Promise.all([
    core.analysis.listAnalysisRuns(id),
    core.requirements.listRequirements(id),
    core.points.listRequirementPoints({ projectId: id }),
    core.modules.listModules(id),
  ]);

  // ✨N 修订徽标只需计数(轻量选列);Modal 打开时再经 action 拉全量
  const revisionCounts = await listRequirementRevisionCounts(
    requirements.map((r) => r.id),
    points.map((p) => p.id),
  );

  // P3b 依据弹窗需要素材标题:逐批次取素材建 materialId → title 映射
  // (原型规模批次量小,N+1 可接受;未命名素材由组件回退显示短 id)
  const materialTitles: Record<string, string> = {};
  await Promise.all(
    runs.map(async (run) => {
      const { materials } = await core.analysis.getAnalysisRun(run.id);
      for (const m of materials) if (m.title) materialTitles[m.id] = m.title;
    }),
  );

  // 卡片只需概要字段,draftResult(LLM 全量草稿)不下发到客户端
  const runCards: RunCardData[] = runs.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    error: r.error,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    materialCount: r.materialCount,
    draftRequirementCount: r.draftRequirementCount,
  }));

  return (
    <AnalysisBrowse
      projectId={id}
      newAnalysisHref={`/project/${id}/analysis/new`}
      pointHrefBase={`/project/${id}/points`}
      runs={runCards}
      requirements={requirements}
      points={points}
      modules={modules}
      materialTitles={materialTitles}
      revisionCounts={revisionCounts}
    />
  );
}
