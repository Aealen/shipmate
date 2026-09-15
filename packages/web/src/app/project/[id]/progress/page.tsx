import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { RequirementPointRow, RequirementWithOverdue } from '@shipmate/core';
import { listRequirements } from '@/actions/analysis';
import { listModulesAction } from '@/actions/modules';
import { getProject } from '@/actions/projects';
import { listRequirementPoints } from '@/actions/points';
import { ProgressView } from '@/components/progress/progress-view';

/**
 * P5b 进度页:header 服务端渲染,统计/分布/清单主体在 ProgressView(客户端)。
 * 另取模块列表下发(spec §14:进度页与看板同款模块筛选,过滤各区块数据)。
 */
export default async function ProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('progress');

  const [summary, modules, reqs, points] = await Promise.all([
    getProject(id).catch(() => null),
    listModulesAction(id).catch(() => []),
    listRequirements(id).catch(() => [] as RequirementWithOverdue[]),
    listRequirementPoints({ projectId: id }).catch(() => [] as RequirementPointRow[]),
  ]);
  if (!summary) notFound();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-0.5">
        <p className="text-xs text-text-muted">{summary.project.name}</p>
        <h1 className="text-[26px] font-bold tracking-tight text-text-primary">{t('title')}</h1>
      </header>
      <ProgressView modules={modules} reqs={reqs} points={points} />
    </div>
  );
}
