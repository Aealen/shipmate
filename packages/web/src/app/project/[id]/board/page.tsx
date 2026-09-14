import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { RequirementPointRow } from '@shipmate/core';
import { listRequirements } from '@/actions/analysis';
import { listModulesAction } from '@/actions/modules';
import { getProject } from '@/actions/projects';
import { listRequirementPoints } from '@/actions/points';
import { listTasks } from '@/actions/tasks';
import { BoardView } from '@/components/board/board-view';

/**
 * P5 任务看板页:四列(pending/in_progress/done/needs_reassessment)。
 * 数据源:tasks.listTasks({projectId}) + 需求点标题映射(卡上标来源)。
 * 另取模块列表与 pointId→moduleId 映射(spec §14:看板按 任务→需求点→需求→模块 链筛选)。
 */
export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('board');

  const [summary, tasks, points, modules, reqs] = await Promise.all([
    getProject(id).catch(() => null),
    listTasks({ projectId: id }).catch(() => []),
    listRequirementPoints({ projectId: id }).catch(() => [] as RequirementPointRow[]),
    listModulesAction(id).catch(() => []),
    listRequirements(id).catch(() => []),
  ]);
  if (!summary) notFound();

  const pointTitles = Object.fromEntries(points.map((p) => [p.id, p.title]));
  // 任务卡不直接携带需求信息,服务端把 需求点→需求.moduleId 链折叠成 pointId→moduleId 映射下发
  const reqModuleIds = new Map(reqs.map((r) => [r.id, r.moduleId]));
  const pointModuleIds = Object.fromEntries(
    points.map((p) => [p.id, reqModuleIds.get(p.requirementId) ?? null]),
  );

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-col gap-0.5">
        <p className="text-xs text-text-muted">{summary.project.name}</p>
        <h1 className="text-lg font-semibold text-text-primary">{t('title')}</h1>
      </header>
      <div className="min-h-0 flex-1">
        <BoardView
          projectId={id}
          tasks={tasks}
          pointTitles={pointTitles}
          modules={modules}
          pointModuleIds={pointModuleIds}
        />
      </div>
    </div>
  );
}
