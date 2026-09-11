import type { ChangeLogRow } from '@shipmate/core';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getProject } from '@/actions/projects';
import { StatusBadge } from '@/components/shared/badge';
import { StatCard } from '@/components/shared/stat-card';

/**
 * P2 概览:统计卡(需求完成度/超期数)+ 需求点状态分布 + 最近变更时间线。
 * 时间线:linkage_impact 徽章微光警示;条目顶部滑入 180ms(spec §14)。
 */
export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('project');
  const locale = await getLocale();

  const summary = await getProject(id).catch(() => null);
  if (!summary) notFound();

  const {
    requirementTotal,
    requirementDone,
    overdueRequirementCount,
    pointStatusCounts,
    recentChanges,
  } = summary;
  const pointTotal = Object.values(pointStatusCounts).reduce((a, b) => a + b, 0);

  const fmt = new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-6">
      {/* spec §14 时间线动画 keyframes(仅本页使用,随页面注入) */}
      <style href="project-overview-anim" precedence="default">{`
        @keyframes timeline-enter {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes impact-glow {
          0%, 100% { box-shadow: 0 0 0 0 transparent; }
          50% { box-shadow: 0 0 8px 1px color-mix(in srgb, var(--danger) 45%, transparent); }
        }
      `}</style>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label={t('statRequirementProgress')}
          value={
            requirementTotal > 0
              ? `${Math.round((requirementDone / requirementTotal) * 100)}%`
              : '—'
          }
          hint={
            requirementTotal > 0
              ? t('statRequirementProgressHint', { done: requirementDone, total: requirementTotal })
              : t('statRequirementProgressNone')
          }
        />
        <StatCard
          label={t('statOverdue')}
          value={overdueRequirementCount}
          hint={t('statOverdueHint')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <PointDistribution
          label={t('pointStatusDistribution')}
          totalLabel={t('pointStatusTotal', { count: pointTotal })}
          emptyLabel={t('pointStatusEmpty')}
          counts={pointStatusCounts}
          total={pointTotal}
        />

        <section className="rounded-xl border border-border bg-surface p-4 lg:col-span-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-text-secondary">{t('recentChanges')}</h2>
            {recentChanges.length > 0 && (
              <span className="text-xs text-text-muted">
                {t('recentChangesHint', { count: recentChanges.length })}
              </span>
            )}
          </div>
          {recentChanges.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">{t('timelineEmpty')}</p>
          ) : (
            <ol className="mt-3 space-y-3 border-l border-border pl-4">
              {recentChanges.map((row, i) => (
                <TimelineItem
                  key={row.id}
                  row={row}
                  time={fmt.format(new Date(row.createdAt))}
                  typeLabel={t(`changeType.${row.changeType}`)}
                  entityLabel={t(`entityType.${row.entityType}`)}
                  delayMs={Math.min(i, 8) * 40}
                />
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

/** 点状态分布:四段堆叠条 + StatusBadge 图例(颜色与徽章配色表一致) */
const SEGMENT_COLORS: Record<keyof typeof pointStatusKeys, string> = {
  draft: 'bg-draft-gray',
  confirmed: 'bg-accent',
  developing: 'bg-warning',
  done: 'bg-success',
};
const pointStatusKeys = { draft: 0, confirmed: 0, developing: 0, done: 0 } as const;

function PointDistribution({
  label,
  totalLabel,
  emptyLabel,
  counts,
  total,
}: {
  label: string;
  totalLabel: string;
  emptyLabel: string;
  counts: Record<keyof typeof pointStatusKeys, number>;
  total: number;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 lg:col-span-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-text-secondary">{label}</h2>
        {total > 0 && <span className="text-xs text-text-muted">{totalLabel}</span>}
      </div>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">{emptyLabel}</p>
      ) : (
        <>
          <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full">
            {(Object.keys(pointStatusKeys) as (keyof typeof pointStatusKeys)[]).map((k) =>
              counts[k] > 0 ? (
                <div
                  key={k}
                  className={SEGMENT_COLORS[k]}
                  style={{ width: `${(counts[k] / total) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {(Object.keys(pointStatusKeys) as (keyof typeof pointStatusKeys)[]).map((k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <StatusBadge status={k} size="sm" />
                <span className="text-sm tabular-nums text-text-primary">{counts[k]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** changeType 徽章配色(与计划状态徽章配色表同风格;linkage_impact 附加微光) */
const CHANGE_TYPE_STYLES: Record<ChangeLogRow['changeType'], string> = {
  create: 'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success',
  update: 'bg-accent-dim text-accent',
  status_change: 'bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-warning',
  linkage_impact: 'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger',
  discard: 'bg-[color-mix(in_srgb,var(--draft-gray)_12%,transparent)] text-draft-gray',
  delete: 'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger',
};

/** 快照中可读的实体名(after 优先,before 兜底;delete 时 after 为 {deleted:true}) */
function snapshotName(snapshot: unknown): string | null {
  if (snapshot && typeof snapshot === 'object') {
    const o = snapshot as Record<string, unknown>;
    if (typeof o.name === 'string' && o.name) return o.name;
    if (typeof o.title === 'string' && o.title) return o.title;
  }
  return null;
}

function TimelineItem({
  row,
  time,
  typeLabel,
  entityLabel,
  delayMs,
}: {
  row: ChangeLogRow;
  time: string;
  typeLabel: string;
  entityLabel: string;
  delayMs: number;
}) {
  const entityName =
    snapshotName(row.afterSnapshot) ?? snapshotName(row.beforeSnapshot) ?? row.entityId.slice(0, 8);

  return (
    <li
      className="relative animate-[timeline-enter_180ms_ease-out_both]"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {/* 时间线轴点 */}
      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-border bg-surface-2" />
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
            CHANGE_TYPE_STYLES[row.changeType]
          } ${row.changeType === 'linkage_impact' ? 'animate-[impact-glow_2.4s_ease-in-out_infinite]' : ''}`}
        >
          {typeLabel}
        </span>
        <span className="text-xs text-text-muted">{entityLabel}</span>
        <span className="min-w-0 truncate text-sm text-text-primary">{entityName}</span>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-text-muted">{time}</span>
      </div>
      {(row.reason || row.actor) && (
        <p className="mt-1 pl-0.5 text-xs text-text-muted">
          {row.reason && <span>{row.reason} · </span>}
          {row.actor}
        </p>
      )}
    </li>
  );
}
