import type { AnalysisRunDetail } from '@shipmate/core';
import { AnalysisWorkbench } from '@/components/analysis/workbench';
import type { ExistingRequirementView } from '@/components/analysis/draft-block';
import { getShipmate } from '@/lib/core';

export const dynamic = 'force-dynamic';

/**
 * P3c 素材分析工作台(Task 7,全项目最重页面)。
 * ?run=<批次id> 进入已有批次;无 run 为新批次,客户端首次添加素材/开始分析时才落批次,
 * 避免空批次垃圾数据。已有需求快照按 title 匹配带出(supplement 块展示已有点实时状态)。
 */
export default async function AnalysisWorkbenchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { id: projectId } = await params;
  const { run: runId } = await searchParams;
  const { core } = await getShipmate();

  // 已有需求 + 全项目点(实时状态):duplicate/supplement 目标匹配与带出展示用
  const [requirements, allPoints] = await Promise.all([
    core.requirements.listRequirements(projectId).catch(() => []),
    core.points.listRequirementPoints({ projectId }).catch(() => []),
  ]);
  const existingRequirements: ExistingRequirementView[] = requirements.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary ?? '',
    status: r.status,
    priority: r.priority,
    points: allPoints
      .filter((p) => p.requirementId === r.id)
      .map((p) => ({ id: p.id, title: p.title, status: p.status, origin: p.origin })),
  }));

  let runDetail: AnalysisRunDetail | null = null;
  if (runId) {
    // 批次不存在或属于其他项目时降级为新批次态(不阻塞工作台)
    const detail = await core.analysis.getAnalysisRun(runId).catch(() => null);
    if (detail && detail.run.projectId === projectId) runDetail = detail;
  }

  return (
    <AnalysisWorkbench
      projectId={projectId}
      run={runDetail}
      existingRequirements={existingRequirements}
    />
  );
}
