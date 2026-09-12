import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getProject } from '@/actions/projects';
import { ProjectHeader } from './project-tabs';

/**
 * P2 项目壳:项目上下文头部(概览路由大头部 / 其余紧凑条,见 ProjectHeader)
 * 常驻于概览/需求分析/进度/看板/审计各子页。项目不存在(DB NOT_FOUND)→ 404。
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations('project');

  const summary = await getProject(id).catch(() => null);
  if (!summary) notFound();
  void t;

  return (
    <div className="flex h-full flex-col">
      {/* 底线由 ProjectHeader 紧凑形态自带(概览形态无,对齐原型) */}
      <div className="shrink-0">
        <ProjectHeader
          id={id}
          name={summary.project.name}
          status={summary.project.status}
          description={summary.project.description}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
