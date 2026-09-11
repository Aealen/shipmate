import type { ProjectSummary } from '@shipmate/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { SVGProps } from 'react';
import { getHomeOverview, getProject } from '@/actions/projects';
import { CreateProjectDialog, type GroupOption } from './create-project-dialog';

/**
 * P1 项目首页:分组分区(组名 + 项目卡片栅格)+ 未分组区。
 * 卡片:名称/描述/需求完成度(getProject 摘要),整卡可点 → /project/[id],
 * hover 边框 accent 120ms(spec §14);全局无项目时空状态引导 + 创建弹窗。
 */
export default async function HomePage() {
  const t = await getTranslations('home');

  // DB 未起等故障下降级为空列表 → 空状态引导(DB 恢复后创建仍会报错提示,可接受)
  const overview = await getHomeOverview().catch(() => ({
    groups: [],
    grouped: [],
    ungrouped: [],
  }));

  const projects = [...overview.grouped, ...overview.ungrouped];

  // 卡片完成度:并行取各项目摘要(本机单用户数据量小;失败降级 null 显示占位)
  const summaries = new Map<string, ProjectSummary | null>();
  await Promise.all(
    projects.map(async (p) => {
      summaries.set(p.id, await getProject(p.id).catch(() => null));
    }),
  );

  const groupOptions: GroupOption[] = overview.groups.map((g) => ({ id: g.id, name: g.name }));
  const sections = [
    ...overview.groups.map((g) => ({
      key: g.id,
      name: g.name,
      items: overview.grouped.filter((p) => p.groupId === g.id),
    })),
    // 未分组区:有未分组项目才显示(规格 P1 帧)
    ...(overview.ungrouped.length > 0
      ? [{ key: '__ungrouped__', name: t('ungrouped'), items: overview.ungrouped }]
      : []),
  ];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text-primary">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('subtitle')}</p>
        </div>
        {projects.length > 0 && <CreateProjectDialog groups={groupOptions} />}
      </div>

      {projects.length === 0 ? (
        <CreateProjectDialog
          groups={groupOptions}
          empty={{ title: t('emptyTitle'), description: t('emptyDesc') }}
        />
      ) : (
        sections.map((section) => (
          <section key={section.key}>
            <h2 className="flex items-center gap-2 text-sm font-medium text-text-secondary">
              {section.name}
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-text-muted">
                {section.items.length}
              </span>
            </h2>
            {section.items.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-text-muted">
                {t('groupEmpty')}
              </p>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {section.items.map((p) => (
                  <ProjectCard
                    key={p.id}
                    id={p.id}
                    name={p.name}
                    description={p.description}
                    summary={summaries.get(p.id) ?? null}
                    doneLabel={t('requirementsDone', {
                      done: summaries.get(p.id)?.requirementDone ?? 0,
                      total: summaries.get(p.id)?.requirementTotal ?? 0,
                    })}
                    noRequirementsLabel={t('noRequirements')}
                    enterLabel={t('enterProject')}
                  />
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}

/** 项目卡片:整卡可点;完成度条 accent 填充;hover 边框 accent + 阴影加深 120ms */
function ProjectCard({
  id,
  name,
  description,
  summary,
  doneLabel,
  noRequirementsLabel,
  enterLabel,
}: {
  id: string;
  name: string;
  description: string | null;
  summary: ProjectSummary | null;
  doneLabel: string;
  noRequirementsLabel: string;
  enterLabel: string;
}) {
  const total = summary?.requirementTotal ?? 0;
  const done = summary?.requirementDone ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Link
      href={`/project/${id}`}
      className="group flex flex-col rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors duration-[120ms] hover:border-accent hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-[15px] font-medium text-text-primary">{name}</h3>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-accent opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100">
          {enterLabel}
          <IconChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 min-h-10 text-sm text-text-secondary">
        {description || <span className="text-text-muted">—</span>}
      </p>
      <div className="mt-3 space-y-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-[120ms]"
            style={{ width: total > 0 ? `${Math.max(pct, 2)}%` : '0%' }}
          />
        </div>
        <p className="text-xs text-text-muted">{total > 0 ? doneLabel : noRequirementsLabel}</p>
      </div>
    </Link>
  );
}

function IconChevronRight(props: SVGProps<SVGSVGElement>) {
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
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
