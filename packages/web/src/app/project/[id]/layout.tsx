import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { SVGProps } from 'react';
import { getProject } from '@/actions/projects';
import { ProjectTabs } from './project-tabs';

/**
 * P2 项目壳:项目上下文条(返回 + 项目名 + Tab 五项,当前高亮)常驻于
 * 概览/需求分析/进度/看板/审计各子页。项目不存在(DB NOT_FOUND)→ 404。
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

  const name = await getProject(id)
    .then((s) => s.project.name)
    .catch(() => null);
  if (name === null) notFound();

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border bg-surface px-6 pt-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1 text-sm text-text-secondary transition-colors duration-[120ms] hover:text-accent"
          >
            <IconArrowLeft className="h-4 w-4" />
            {t('backHome')}
          </Link>
          <span className="h-4 w-px shrink-0 bg-border" />
          <h1 className="min-w-0 truncate text-[15px] font-semibold text-text-primary">{name}</h1>
        </div>
        <div className="mt-2">
          <ProjectTabs id={id} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function IconArrowLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </svg>
  );
}
