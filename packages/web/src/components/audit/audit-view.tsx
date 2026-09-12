'use client';

import type { ActorKind, AuditReport, ChangeLogRow } from '@shipmate/core';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { StatCard } from '@/components/shared/stat-card';

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

/** changeType → 彩字(徽章统一灰底小方徽,见 shared/badge;原词展示) */
const CHANGE_TYPE_TEXT: Record<ChangeType, string> = {
  create: 'text-ai',
  update: 'text-accent',
  status_change: 'text-draft-gray',
  linkage_impact: 'text-danger',
  discard: 'text-draft-gray',
  delete: 'text-danger',
};

/** actor 三类分布条着色(原型 P6:human 绿 / ai 紫 / agent 蓝) */
const ACTOR_KIND_BAR: Record<ActorKind, string> = {
  human: 'bg-success',
  ai: 'bg-ai',
  mcp: 'bg-accent',
};

/** 实体分布条着色(原型 P6:需求点蓝 / 任务绿 / 素材紫 / 分组项目灰) */
const ENTITY_BAR: Record<string, string> = {
  group: 'bg-draft-gray',
  project: 'bg-draft-gray',
  analysis_run: 'bg-ai',
  material: 'bg-ai',
  requirement: 'bg-accent',
  requirement_point: 'bg-accent',
  task: 'bg-success',
};

/** 与 core audit.service 的 actorKind 同规则:human / mcp:<name> / 其余归 ai */
function actorKindOf(actor: string): ActorKind {
  if (actor === 'human') return 'human';
  if (actor.startsWith('mcp:')) return 'mcp';
  return 'ai';
}

/**
 * P6 审计页(对齐原型帧):四统计卡一行 + 操作者分布(行式条形)+
 * 实体分布 + 每日趋势(纯 div 柱图)+ 筛选 + 全宽行式时间线。
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

  const total = report.timeline.length;
  const linkageCount = report.timeline.filter((l) => l.changeType === 'linkage_impact').length;
  const aiCount = report.actorDistribution.ai;
  const aiPct = total > 0 ? Math.round((aiCount / total) * 100) : 0;

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [locale],
  );

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      {/* 四统计卡 */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={t('statTotalChanges')} value={total} />
        <StatCard
          label={t('statAiShare')}
          value={`${aiPct}%`}
          valueClassName="text-ai"
          hint={`${aiCount} / ${total}`}
        />
        <StatCard label={t('statLinkages')} value={linkageCount} valueClassName="text-warning" />
        <StatCard
          label={t('statAgentOps')}
          value={report.actorDistribution.mcp}
          valueClassName="text-accent"
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* 筛选:实体类型 / 操作者 */}
          <div className="flex flex-wrap items-center gap-3">
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
              {filtered.length} / {total}
            </span>
          </div>

          {/* 时间线(全宽白卡,行式条目) */}
          <section className="flex flex-col gap-2.5 rounded-[10px] border border-transparent bg-surface p-[18px]">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-12 text-center">
                <p className="text-sm text-text-secondary">
                  {total === 0 ? t('emptyTimeline') : t('emptyFilter')}
                </p>
                <p className="text-xs text-text-muted">{t('emptyHint')}</p>
              </div>
            ) : (
              <ol className="flex flex-col gap-2">
                {filtered.map((log) => (
                  <TimelineItem key={log.id} log={log} fmt={fmt} />
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* 右侧统计列 */}
        <aside className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-[10px] border border-transparent bg-surface p-[18px]">
            <h3 className="text-[13px] font-bold text-text-primary">{t('statsActor')}</h3>
            {(['human', 'ai', 'mcp'] as const).map((kind) => (
              <BarRow
                key={kind}
                label={t(`actor.${kind}`)}
                count={report.actorDistribution[kind]}
                total={total}
                barClass={ACTOR_KIND_BAR[kind]}
                barHeight="h-2"
              />
            ))}
          </section>

          <section className="flex flex-col gap-2.5 rounded-[10px] border border-transparent bg-surface p-[18px]">
            <h3 className="text-[13px] font-bold text-text-primary">{t('statsEntity')}</h3>
            {Object.keys(report.entityTypeDistribution).length === 0 ? (
              <p className="text-xs text-text-muted">{t('statsEmpty')}</p>
            ) : (
              ENTITY_TYPES.filter((et) => report.entityTypeDistribution[et]).map((et) => (
                <BarRow
                  key={et}
                  label={t(`entityType.${et}`)}
                  count={report.entityTypeDistribution[et]!}
                  total={total}
                  barClass={ENTITY_BAR[et] ?? 'bg-accent'}
                  barHeight="h-1.5"
                />
              ))
            )}
          </section>

          <section className="flex flex-col gap-2.5 rounded-[10px] border border-transparent bg-surface p-[18px]">
            <h3 className="text-[13px] font-bold text-text-primary">{t('statsDaily')}</h3>
            <DailyBars counts={report.dailyCounts} emptyText={t('statsEmpty')} />
          </section>
        </aside>
      </div>
    </div>
  );
}

/** 行式条目:类型圆点 + 类型徽章(原词)+ 实体 + 原因 + actor + 时间 */
function TimelineItem({ log, fmt }: { log: ChangeLogRow; fmt: Intl.DateTimeFormat }) {
  const t = useTranslations('audit');

  return (
    <li className="flex items-center gap-2.5 rounded-[7px] bg-bg px-3 py-[11px]">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${CHANGE_TYPE_TEXT[log.changeType]}`}
      />
      <span
        className={`inline-flex shrink-0 items-center rounded-[4px] bg-surface-2 px-[5px] py-[2px] text-[9px] font-medium leading-none ${CHANGE_TYPE_TEXT[log.changeType]}`}
      >
        {log.changeType}
      </span>
      <span className="shrink-0 text-xs leading-none text-text-primary">
        {t(`entityType.${log.entityType}`)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
        {log.reason ? log.reason : ''}
      </span>
      <span className={`shrink-0 text-[10px] leading-none ${ACTOR_TEXT[actorKindOf(log.actor)]}`}>
        {log.actor}
      </span>
      <time className="shrink-0 text-[10px] leading-none tabular-nums text-text-muted">
        {fmt.format(new Date(log.createdAt))}
      </time>
    </li>
  );
}

/** actor 文字色(行内 actor 标签) */
const ACTOR_TEXT: Record<ActorKind, string> = {
  human: 'text-success',
  ai: 'text-ai',
  mcp: 'text-accent',
};

/** 分布行(原型:label 12px 定宽 + 圆角条 + 右侧计数) */
function BarRow({
  label,
  count,
  total,
  barClass,
  barHeight,
}: {
  label: string;
  count: number;
  total: number;
  barClass: string;
  barHeight: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[130px] shrink-0 truncate text-xs text-text-secondary">{label}</span>
      <span className="min-w-0 flex-1 overflow-hidden rounded-[4px] bg-bg" style={{ height: 8 }}>
        <span className={`block h-full rounded-[4px] ${barClass}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{count}</span>
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
