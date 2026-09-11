import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { RequirementPointRow } from '@shipmate/core';
import { getProject } from '@/actions/projects';
import { listRequirementPoints } from '@/actions/points';
import { listTasks } from '@/actions/tasks';
import { BoardView } from '@/components/board/board-view';

/**
 * P5 任务看板页:四列(pending/in_progress/done/needs_reassessment)。
 * 数据源:tasks.listTasks({projectId}) + 需求点标题映射(卡上标来源)。
 */
export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('board');

  const [summary, tasks, points] = await Promise.all([
    getProject(id).catch(() => null),
    listTasks({ projectId: id }).catch(() => []),
    listRequirementPoints({ projectId: id }).catch(() => [] as RequirementPointRow[]),
  ]);
  if (!summary) notFound();

  const pointTitles = Object.fromEntries(points.map((p) => [p.id, p.title]));

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-0.5">
        <p className="text-xs text-text-muted">{summary.project.name}</p>
        <h1 className="text-lg font-semibold text-text-primary">{t('title')}</h1>
      </header>
      <div className="min-h-0 flex-1">
        <BoardView projectId={id} tasks={tasks} pointTitles={pointTitles} />
      </div>
    </div>
  );
}
