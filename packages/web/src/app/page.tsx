import type { ProjectSummary } from '@shipmate/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { SVGProps } from 'react';
import { getHomeOverview, getProject } from '@/actions/projects';
import { CreateProjectDialog, type GroupOption } from './create-project-dialog';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * P1 项目首页(对齐原型):页头(标题 22px + 「N 个项目 · M 个分组」统计 +
 * 新建项目)+ 全宽两列卡片栅格。卡片:名称 + 分组徽章 / 描述 / 需求完成度
 * 进度条 / 需求点状态圆点行 / 相对时间 + 「进入项目 ›」。
 * 侧栏分组行经 /?group=<id>|none 过滤;全局无项目时空状态引导 + 创建弹窗。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const t = await getTranslations('home');
  const tShared = await getTranslations('shared.badge');
  const { group: groupFilter } = await searchParams;

  // DB 未起等故障下降级为空列表 → 空状态引导(DB 恢复后创建仍会报错提示,可接受)
  const overview = await getHomeOverview().catch(() => ({
    groups: [],
    grouped: [],
    ungrouped: [],
  }));

  const groupNameById = new Map(overview.groups.map((g) => [g.id, g.name]));
  const groupOptions: GroupOption[] = overview.groups.map((g) => ({ id: g.id, name: g.name }));

  // 过滤:/?group=<id> 单组;/?group=none 未分组;默认全部
  // 注:getHomeOverview().grouped 即全量项目,ungrouped 为其中 groupId 为空的子集
  const allProjects = overview.grouped;
  const filtered =
    groupFilter == null || groupFilter === ''
      ? allProjects
      : groupFilter === 'none'
        ? overview.ungrouped
        : allProjects.filter((p) => p.groupId === groupFilter);

  // 卡片完成度:并行取各项目摘要(本机单用户数据量小;失败降级 null 显示占位)
  const summaries = new Map<string, ProjectSummary | null>();
  await Promise.all(
    filtered.map(async (p) => {
      summaries.set(p.id, await getProject(p.id).catch(() => null));
    }),
  );

  const heading =
    groupFilter == null || groupFilter === ''
      ? t('title')
      : groupFilter === 'none'
        ? t('ungrouped')
        : (groupNameById.get(groupFilter) ?? t('title'));
  const groupCountLabel =
    groupFilter == null || groupFilter === ''
      ? t('subtitleStats', { projects: allProjects.length, groups: overview.groups.length })
      : t('projectCount', { count: filtered.length });

  const statusDotLabels = {
    done: tShared('done'),
    developing: tShared('developing'),
    draft: tShared('draft'),
    confirmed: tShared('confirmed'),
  } as const;

  return (
    <div className="flex w-full flex-col gap-5 p-8">
      <div className="flex items-center gap-3">
        <h1 className="text-[22px] font-bold leading-tight text-text-primary">{heading}</h1>
        <span className="text-[13px] text-text-muted">{groupCountLabel}</span>
        <span className="min-w-0 flex-1" />
        {allProjects.length > 0 && <CreateProjectDialog groups={groupOptions} />}
      </div>

      {allProjects.length === 0 ? (
        <CreateProjectDialog
          groups={groupOptions}
          empty={{ title: t('emptyTitle'), description: t('emptyDesc') }}
        />
      ) : filtered.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-border px-4 py-10 text-center text-sm text-text-muted">
          {t('groupEmpty')}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {filtered.map((p) => {
            const s = summaries.get(p.id) ?? null;
            // 原型语义「N% 需求点完成」:按需求点 done 占比(需求级状态不算)
            const pointTotal = s
              ? Object.values(s.pointStatusCounts).reduce((a, b) => a + b, 0)
              : 0;
            const pctDone =
              s && pointTotal > 0 ? Math.round((s.pointStatusCounts.done / pointTotal) * 100) : 0;
            return (
              <ProjectCard
                key={p.id}
                id={p.id}
                name={p.name}
                description={p.description}
                groupName={p.groupId ? (groupNameById.get(p.groupId) ?? null) : null}
                summary={s}
                labels={{
                  done: statusDotLabels.done,
                  developing: statusDotLabels.developing,
                  draft: statusDotLabels.draft,
                  confirmed: statusDotLabels.confirmed,
                  pctDone: t('requirementsDonePercent', { pct: pctDone }),
                  noRequirements: t('noRequirements'),
                  enter: t('enterProject'),
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 项目卡片(原型 P1):整卡可点;完成度条 accent 填充;hover 边框 accent 120ms */
function ProjectCard({
  id,
  name,
  description,
  groupName,
  summary,
  labels,
}: {
  id: string;
  name: string;
  description: string | null;
  groupName: string | null;
  summary: ProjectSummary | null;
  labels: {
    done: string;
    developing: string;
    draft: string;
    confirmed: string;
    pctDone: string;
    noRequirements: string;
    enter: string;
  };
}) {
  const counts = summary?.pointStatusCounts;
  const total = summary?.requirementTotal ?? 0;
  const done = summary?.requirementDone ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const dotStats = [
    { label: labels.done, value: counts?.done ?? 0, color: 'bg-success' },
    { label: labels.developing, value: counts?.developing ?? 0, color: 'bg-warning' },
    { label: labels.draft, value: counts?.draft ?? 0, color: 'bg-draft-gray' },
    { label: labels.confirmed, value: counts?.confirmed ?? 0, color: 'bg-accent' },
  ];

  return (
    <Link
      href={`/project/${id}`}
      className="group flex flex-col gap-3 rounded-[10px] border border-transparent bg-surface p-5 transition-colors duration-[120ms] hover:border-accent"
    >
      <div className="flex items-center gap-2.5">
        <h3 className="min-w-0 truncate text-[15px] font-bold text-text-primary">{name}</h3>
        <span className="min-w-0 flex-1" />
        {groupName && (
          <span className="shrink-0 rounded-[5px] bg-surface-2 px-2 py-[3px] text-[11px] leading-none text-text-secondary">
            {groupName}
          </span>
        )}
      </div>
      <p className="line-clamp-1 min-h-5 w-full text-xs text-text-secondary">
        {description || <span className="text-text-muted">—</span>}
      </p>

      <div className="flex items-center gap-3">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-surface-2">
          <div
            className="h-full rounded-[3px] bg-accent transition-[width] duration-[120ms]"
            style={{ width: total > 0 ? `${Math.max(pct, 2)}%` : '0%' }}
          />
        </div>
        <span className="shrink-0 text-[11px] text-text-muted">
          {total > 0 ? labels.pctDone : labels.noRequirements}
        </span>
      </div>

      <div className="flex items-center gap-3.5">
        {dotStats.map((s) => (
          <span key={s.label} className="flex shrink-0 items-center gap-[5px]">
            <span className={`h-1.5 w-1.5 rounded-full ${s.color}`} />
            <span className="text-[11px] text-text-muted">
              {s.label} {s.value}
            </span>
          </span>
        ))}
        <span className="min-w-0 flex-1" />
        <span className="shrink-0 text-[11px] text-text-muted">
          {summary ? formatRelativeTime(summary.project.updatedAt) : ''}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-bold text-accent">
          {labels.enter}
          <IconChevronRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

/** 相对时间(卡片右下角):刚刚 / N 分钟前 / N 小时前 / N 天前,更久落回日期 */
function formatRelativeTime(ms: number): string {
  const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  const diff = Date.now() - ms;
  if (diff < MS_PER_HOUR) {
    const minutes = Math.floor(diff / MS_PER_MINUTE);
    return minutes < 1 ? '刚刚' : rtf.format(-minutes, 'minute');
  }
  if (diff < MS_PER_DAY) return rtf.format(-Math.floor(diff / MS_PER_HOUR), 'hour');
  if (diff < 7 * MS_PER_DAY) return rtf.format(-Math.floor(diff / MS_PER_DAY), 'day');
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(ms);
}

function IconChevronRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
