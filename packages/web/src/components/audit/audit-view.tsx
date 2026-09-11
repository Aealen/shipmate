'use client';

import type { ActorKind, AuditReport, ChangeLogRow } from '@shipmate/core';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';

/** 实体类型枚举(与 core schema change_logs.entity_type 一致) */
const ENTITY_TYPES = [
  'group',
  'project',
  'analysis_run',
  'material',
  'requirement',
  'requirement_point',
  'task',
] as const;

type ChangeType = ChangeLogRow['changeType'];

/** change_type 徽章配色(与 shared/badge 的 color-mix 写法一致);linkage_impact 用 ai 紫加静态微光警示 */
const CHANGE_TYPE_STYLES: Record<ChangeType, string> = {
  create: 'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success',
  update: 'bg-accent-dim text-accent',
  status_change: 'bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-warning',
  linkage_impact: 'bg-[color-mix(in_srgb,var(--ai)_12%,transparent)] text-ai shadow-[0_0_8px_var(--ai)]',
  discard: 'bg-[color-mix(in_srgb,var(--draft-gray)_12%,transparent)] text-draft-gray',
  delete: 'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger',
};

/** actor 三类分布条的着色:human=accent / ai=ai 紫 / mcp=draft-gray */
const ACTOR_KIND_BAR: Record<ActorKind, string> = {
  human: 'bg-accent',
  ai: 'bg-ai',
  mcp: 'bg-draft-gray',
};

/** 与 core audit.service 的 actorKind 同规则:human / mcp:<name> / 其余归 ai */
function actorKindOf(actor: string): ActorKind {
  if (actor === 'human') return 'human';
  if (actor.startsWith('mcp:')) return 'mcp';
  return 'ai';
}

/**
 * P6 审计页视图:筛选(实体类型/操作者)+ 变更时间线 + 右侧统计
 * (操作者分布 / 实体类型分布 / 每日变更趋势迷你柱图——纯 div,不引图表库)。
 * 数据由服务端 getProjectAuditReport 一次性取回,筛选纯客户端完成。
 */
export function AuditView({ report }: { report: AuditReport }) {
  const t = useTranslations('audit');
  const locale = useLocale();
  const [entityType, setEntityType] = useState<string>('all');
  const [actor, setActor] = useState<string>('all');

  const actors = useMemo(
    () => [...new Set(report.timeline.map((l) => l.actor))].sort(),
    [report.timeline],
  );

  const filtered = useMemo(
    () =>
      report.timeline.filter(
        (l) =>
          (entityType === 'all' || l.entityType === entityType) &&
          (actor === 'all' || l.actor === actor),
      ),
    [report.timeline, entityType, actor],
  );

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <header>
        <h1 className="text-lg font-semibold text-text-primary">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('description')}</p>
      </header>

      {/* 筛选:实体类型 / 操作者 */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          {t('filterEntityType')}
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
          >
            <option value="all">{t('filterAll')}</option>
            {ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>
                {t(`entityType.${et}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          {t('filterActor')}
          <select
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
          >
            <option value="all">{t('filterAll')}</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto text-xs tabular-nums text-text-muted">
          {filtered.length} / {report.timeline.length}
        </span>
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* 时间线 */}
        <section className="rounded-xl border border-border bg-surface p-5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-12 text-center">
              <p className="text-sm text-text-secondary">
                {report.timeline.length === 0 ? t('emptyTimeline') : t('emptyFilter')}
              </p>
              <p className="text-xs text-text-muted">{t('emptyHint')}</p>
            </div>
          ) : (
            <ol className="relative space-y-5 border-l border-border pl-6">
              {filtered.map((log) => (
                <TimelineItem key={log.id} log={log} fmt={fmt} />
              ))}
            </ol>
          )}
        </section>

        {/* 右侧统计 */}
        <aside className="space-y-4">
          <StatsCard title={t('statsActor')}>
            {(['human', 'ai', 'mcp'] as const).map((kind) => (
              <DistRow
                key={kind}
                label={t(`actor.${kind}`)}
                count={report.actorDistribution[kind]}
                total={report.timeline.length}
                barClass={ACTOR_KIND_BAR[kind]}
              />
            ))}
          </StatsCard>

          <StatsCard title={t('statsEntity')}>
            {Object.keys(report.entityTypeDistribution).length === 0 ? (
              <p className="text-xs text-text-muted">{t('statsEmpty')}</p>
            ) : (
              ENTITY_TYPES.filter((et) => report.entityTypeDistribution[et]).map((et) => (
                <DistRow
                  key={et}
                  label={t(`entityType.${et}`)}
                  count={report.entityTypeDistribution[et]!}
                  total={report.timeline.length}
                  barClass="bg-accent"
                />
              ))
            )}
          </StatsCard>

          <StatsCard title={t('statsDaily')}>
            <DailyBars counts={report.dailyCounts} emptyText={t('statsEmpty')} />
          </StatsCard>
        </aside>
      </div>
    </div>
  );
}

/** 单条时间线记录:类型徽章 + 实体类型 + 操作者(带类别色点)+ 时间 + 可选原因 */
function TimelineItem({ log, fmt }: { log: ChangeLogRow; fmt: Intl.DateTimeFormat }) {
  const t = useTranslations('audit');

  return (
    <li className="relative">
      <span
        className="absolute -left-[27px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent/70 ring-4 ring-bg"
        aria-hidden
      />
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${CHANGE_TYPE_STYLES[log.changeType]}`}
        >
          {t(`changeType.${log.changeType}`)}
        </span>
        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-secondary">
          {t(`entityType.${log.entityType}`)}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${ACTOR_KIND_BAR[actorKindOf(log.actor)]}`} />
          {log.actor}
        </span>
        <time className="ml-auto shrink-0 text-xs tabular-nums text-text-muted">
          {fmt.format(new Date(log.createdAt))}
        </time>
      </div>
      {log.reason && (
        <p className="mt-1.5 break-words text-xs text-text-secondary">
          <span className="text-text-muted">{t('reason')}:</span>
          {log.reason}
        </p>
      )}
    </li>
  );
}

/** 统计卡容器:标题 + 内容行 */
function StatsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 transition-colors duration-[120ms] hover:border-accent">
      <h3 className="text-xs font-medium text-text-muted">{title}</h3>
      <div className="mt-3 space-y-2.5">{children}</div>
    </div>
  );
}

/** 分布行:名称 + 计数 + 占比条(宽度按 total 归一) */
function DistRow({
  label,
  count,
  total,
  barClass,
}: {
  label: string;
  count: number;
  total: number;
  barClass: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className="tabular-nums text-text-muted">{count}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * 每日变更趋势迷你柱图:纯 div 高度条(禁图表库)。
 * 取最近 30 个有数据的日期,高度按最大值归一,hover title 显示日期与计数。
 */
function DailyBars({
  counts,
  emptyText,
}: {
  counts: { date: string; count: number }[];
  emptyText: string;
}) {
  const window = counts.slice(-30);
  const max = Math.max(1, ...window.map((c) => c.count));

  if (window.length === 0) {
    return <p className="text-xs text-text-muted">{emptyText}</p>;
  }

  return (
    <div>
      <div className="flex h-16 items-end gap-[3px]">
        {window.map((c) => (
          <div
            key={c.date}
            title={`${c.date} · ${c.count}`}
            className="min-w-[4px] flex-1 rounded-t bg-accent/70 transition-colors duration-[120ms] hover:bg-accent"
            style={{ height: `${Math.max(6, (c.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-text-muted">
        <span>{window[0]!.date}</span>
        <span>{window[window.length - 1]!.date}</span>
      </div>
    </div>
  );
}
