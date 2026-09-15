'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ModuleSummary, RequirementPointRow, RequirementWithOverdue } from '@shipmate/core';
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

/** 模块筛选值:all = 全部模块(默认);UNTAGGED = 未归类(需求无模块);其余为模块 id */
const MODULE_UNTAGGED = '__untagged';
type ModuleFilter = typeof MODULE_UNTAGGED | 'all' | string;

/** 服务端固定格式化 YYYY-MM-DD,避免 locale 差异 */
function fmtDate(ms: number | null): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * P5b 进度页主体(客户端):模块筛选行 + 统计卡(需求完成度/超期/需求点完成/临期)+
 * 点状态分布条 + 按需求聚合完成度卡 + 超期/临期清单(红/黄)。
 * 模块筛选按 需求.moduleId 过滤各区块,统计与分布随筛选结果实时重算(spec §14);
 * 无模块数据时筛选行整组不渲染。
 */
export function ProgressView({
  modules,
  reqs,
  points,
}: {
  modules: ModuleSummary[];
  reqs: RequirementWithOverdue[];
  points: RequirementPointRow[];
}) {
  const t = useTranslations('progress');
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all');

  // 需求点不直接带模块,经 requirementId → 需求.moduleId 关联
  const moduleByReq = useMemo(
    () => new Map(reqs.map((r) => [r.id, r.moduleId ?? null])),
    [reqs],
  );

  const filteredReqs = useMemo(
    () =>
      reqs.filter((r) => {
        const moduleId = r.moduleId ?? null;
        return (
          moduleFilter === 'all' ||
          (moduleFilter === MODULE_UNTAGGED ? moduleId === null : moduleId === moduleFilter)
        );
      }),
    [reqs, moduleFilter],
  );
  const filteredPoints = useMemo(
    () =>
      points.filter((p) => {
        const moduleId = moduleByReq.get(p.requirementId) ?? null;
        return (
          moduleFilter === 'all' ||
          (moduleFilter === MODULE_UNTAGGED ? moduleId === null : moduleId === moduleFilter)
        );
      }),
    [points, moduleFilter, moduleByReq],
  );

  // 统计随筛选重算(原项目级 summary 统计仅在「全部模块」时与之重合)
  const totalPoints = filteredPoints.length;
  const donePoints = filteredPoints.filter((p) => p.status === 'done').length;
  const overdueReqs = filteredReqs.filter((r) => r.overdue);
  const dueSoonReqs = filteredReqs.filter((r) => r.dueSoon && !r.overdue);
  const dist = useMemo(() => {
    const counts: Record<(typeof POINT_DIST)[number]['key'], number> = {
      draft: 0,
      confirmed: 0,
      developing: 0,
      done: 0,
    };
    for (const p of filteredPoints) counts[p.status] += 1;
    return counts;
  }, [filteredPoints]);
  const distTotal = filteredPoints.length;

  const pointsByReq = useMemo(() => {
    const map = new Map<string, RequirementPointRow[]>();
    for (const p of filteredPoints) {
      const list = map.get(p.requirementId);
      if (list) list.push(p);
      else map.set(p.requirementId, [p]);
    }
    return map;
  }, [filteredPoints]);

  return (
    <>
      {/* 模块筛选(与看板同款);无模块时整行不渲染 */}
      {modules.length > 0 && (
        <div className="flex justify-end">
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            {t('moduleLabel')}
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="h-8 rounded-[8px] border border-border bg-surface px-2 text-[13px] text-text-primary outline-none transition-colors focus:border-accent"
            >
              <option value="all">{t('moduleAll')}</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value={MODULE_UNTAGGED}>{t('moduleUntagged')}</option>
            </select>
          </label>
        </div>
      )}

      {/* 统计卡行 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t('statRequirement')}
          value={`${filteredReqs.filter((r) => r.status === 'done').length}/${filteredReqs.length}`}
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
      <section className="rounded-[14px] bg-surface p-6">
        <h2 className="text-[15px] font-bold tracking-tight text-text-primary">
          {t('pointDistribution')}
        </h2>
        {distTotal === 0 ? (
          <p className="mt-3 text-xs text-text-muted">{t('noPoints')}</p>
        ) : (
          <>
            <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full">
              {POINT_DIST.map(({ key, color }) => {
                const count = dist[key];
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
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 text-xs text-text-secondary"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: color }}
                    aria-hidden
                  />
                  {t(`pointStatus.${key}`)}
                  <span className="tabular-nums text-text-muted">{dist[key]}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 按需求聚合完成度 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-bold tracking-tight text-text-primary">
          {t('byRequirement')}
        </h2>
        {filteredReqs.length === 0 ? (
          <p className="rounded-[14px] bg-surface p-6 text-xs text-text-muted">
            {t('noRequirements')}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {filteredReqs.map((req) => {
              const reqPoints = pointsByReq.get(req.id) ?? [];
              const done = reqPoints.filter((p) => p.status === 'done').length;
              const pct = reqPoints.length ? Math.round((done / reqPoints.length) * 100) : 0;
              const start = fmtDate(req.planStartAt);
              const due = fmtDate(req.planDueAt);
              return (
                <article
                  key={req.id}
                  className="rounded-[14px] bg-surface p-6 transition-shadow duration-[120ms] hover:shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`shrink-0 text-xs font-semibold ${PRIORITY_COLORS[req.priority] ?? ''}`}
                    >
                      {req.priority}
                    </span>
                    <h3
                      className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary"
                      title={req.title}
                    >
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
                      {start && due
                        ? t('planPeriod', { start, end: due })
                        : t('planDueOnly', { end: due ?? start ?? '' })}
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
        <section className="rounded-[14px] bg-surface p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-text-primary">
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
                  <span
                    className="min-w-0 flex-1 truncate text-sm text-text-primary"
                    title={req.title}
                  >
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

        <section className="rounded-[14px] bg-surface p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-text-primary">
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
                  <span
                    className="min-w-0 flex-1 truncate text-sm text-text-primary"
                    title={req.title}
                  >
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
    </>
  );
}
