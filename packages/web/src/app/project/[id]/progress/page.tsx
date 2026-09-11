import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { RequirementPointRow, RequirementWithOverdue } from '@shipmate/core';
import { listRequirements } from '@/actions/analysis';
import { getProject } from '@/actions/projects';
import { listRequirementPoints } from '@/actions/points';
import { DueSoonBadge, OverdueBadge, StatusBadge } from '@/components/shared/badge';
import { StatCard } from '@/components/shared/stat-card';

/** 需求点四状态在分布条中的展示顺序与配色(计划配色表) */
const POINT_DIST: { key: 'draft' | 'confirmed' | 'developing' | 'done'; color: string }[] = [
  { key: 'draft', color: 'var(--draft-gray)' },
  { key: 'confirmed', color: 'var(--accent)' },
  { key: 'developing', color: 'var(--warning)' },
  { key: 'done', color: 'var(--success)' },
];

/** 优先级徽章配色:P0 红 / P1 黄 / P2 蓝 / P3 灰(重要度递减) */
const PRIORITY_COLORS: Record<string, string> = {
  P0: 'text-danger',
  P1: 'text-warning',
  P2: 'text-accent',
  P3: 'text-text-muted',
};

/** 服务端固定格式化 YYYY-MM-DD,避免 locale 差异 */
function fmtDate(ms: number | null): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * P5b 进度页:统计卡(需求完成度/超期/需求点完成/临期)+ 点状态分布条 +
 * 按需求聚合完成度卡 + 超期/临期清单(红/黄)。数据全部服务端渲染,无客户端交互。
 */
export default async function ProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('progress');

  const [summary, reqs, points] = await Promise.all([
    getProject(id).catch(() => null),
    listRequirements(id).catch(() => [] as RequirementWithOverdue[]),
    listRequirementPoints({ projectId: id }).catch(() => [] as RequirementPointRow[]),
  ]);
  if (!summary) notFound();

  const pointsByReq = new Map<string, RequirementPointRow[]>();
  for (const p of points) {
    const list = pointsByReq.get(p.requirementId);
    if (list) list.push(p);
    else pointsByReq.set(p.requirementId, [p]);
  }

  const totalPoints = points.length;
  const donePoints = points.filter((p) => p.status === 'done').length;
  const overdueReqs = reqs.filter((r) => r.overdue);
  const dueSoonReqs = reqs.filter((r) => r.dueSoon && !r.overdue);
  const dist = summary.pointStatusCounts;
  const distTotal = POINT_DIST.reduce((sum, { key }) => sum + (dist[key] ?? 0), 0);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-0.5">
        <p className="text-xs text-text-muted">{summary.project.name}</p>
        <h1 className="text-lg font-semibold text-text-primary">{t('title')}</h1>
      </header>

      {/* 统计卡行 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t('statRequirement')}
          value={`${summary.requirementDone}/${summary.requirementTotal}`}
        />
        <StatCard label={t('statOverdue')} value={overdueReqs.length} />
        <StatCard
          label={t('statPoint')}
          value={`${donePoints}/${totalPoints}`}
          hint={totalPoints ? `${Math.round((donePoints / totalPoints) * 100)}%` : undefined}
        />
        <StatCard label={t('statDueSoon')} value={dueSoonReqs.length} />
      </div>

      {/* 点状态分布 */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-primary">{t('pointDistribution')}</h2>
        {distTotal === 0 ? (
          <p className="mt-3 text-xs text-text-muted">{t('noPoints')}</p>
        ) : (
          <>
            <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full">
              {POINT_DIST.map(({ key, color }) => {
                const count = dist[key] ?? 0;
                if (!count) return null;
                return (
                  <div
                    key={key}
                    style={{ width: `${(count / distTotal) * 100}%`, background: color }}
                  />
                );
              })}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
              {POINT_DIST.map(({ key, color }) => (
                <span key={key} className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
                  {t(`pointStatus.${key}`)}
                  <span className="tabular-nums text-text-muted">{dist[key] ?? 0}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 按需求聚合完成度 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-text-primary">{t('byRequirement')}</h2>
        {reqs.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-4 text-xs text-text-muted">
            {t('noRequirements')}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {reqs.map((req) => {
              const reqPoints = pointsByReq.get(req.id) ?? [];
              const done = reqPoints.filter((p) => p.status === 'done').length;
              const pct = reqPoints.length ? Math.round((done / reqPoints.length) * 100) : 0;
              const start = fmtDate(req.planStartAt);
              const due = fmtDate(req.planDueAt);
              return (
                <article
                  key={req.id}
                  className="rounded-xl border border-border bg-surface p-4 transition-colors duration-[120ms] hover:border-accent"
                >
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 text-xs font-semibold ${PRIORITY_COLORS[req.priority] ?? ''}`}>
                      {req.priority}
                    </span>
                    <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary" title={req.title}>
                      {req.title}
                    </h3>
                    <StatusBadge status={req.status} size="sm" />
                    {req.overdue && <OverdueBadge days={req.overdueDays} />}
                    {!req.overdue && req.dueSoon && <DueSoonBadge />}
                  </div>
                  {req.summary && (
                    <p className="mt-1 line-clamp-1 text-xs text-text-muted" title={req.summary}>
                      {req.summary}
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-success transition-all duration-[120ms]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-text-muted">
                      {reqPoints.length
                        ? t('pointsDone', { done, total: reqPoints.length })
                        : t('noPoints')}
                    </span>
                  </div>
                  {(start || due) && (
                    <p className="mt-1.5 text-[11px] text-text-muted">
                      {start && due ? t('planPeriod', { start, end: due }) : t('planDueOnly', { end: due ?? start ?? '' })}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 超期 / 临期清单 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <span className="h-2 w-2 rounded-full bg-danger" aria-hidden />
            {t('overdueList')}
            <span className="text-xs tabular-nums text-text-muted">{overdueReqs.length}</span>
          </h2>
          {overdueReqs.length === 0 ? (
            <p className="mt-3 text-xs text-text-muted">{t('noOverdue')}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {overdueReqs.map((req) => (
                <li
                  key={req.id}
                  className="flex items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary" title={req.title}>
                    {req.title}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted">
                    {t('dueAt', { date: fmtDate(req.planDueAt) ?? '—' })}
                  </span>
                  <OverdueBadge days={req.overdueDays} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
            {t('dueSoonList')}
            <span className="text-xs tabular-nums text-text-muted">{dueSoonReqs.length}</span>
          </h2>
          {dueSoonReqs.length === 0 ? (
            <p className="mt-3 text-xs text-text-muted">{t('noDueSoon')}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {dueSoonReqs.map((req) => (
                <li
                  key={req.id}
                  className="flex items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary" title={req.title}>
                    {req.title}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted">
                    {t('dueAt', { date: fmtDate(req.planDueAt) ?? '—' })}
                  </span>
                  <DueSoonBadge />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
