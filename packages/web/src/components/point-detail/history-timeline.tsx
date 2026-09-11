'use client';

import { useTranslations } from 'next-intl';
import type { ChangeLogRow, ChangeType } from '@shipmate/core';

/** changeType → 圆点/徽章配色(计划:P2/P4 时间线,linkage_impact 用 AI 紫微光) */
const CHANGE_STYLE: Record<ChangeType, { dot: string; badge: string }> = {
  create: {
    dot: 'bg-success',
    badge: 'text-success bg-[color-mix(in_srgb,var(--success)_12%,transparent)]',
  },
  update: {
    dot: 'bg-accent',
    badge: 'text-accent bg-accent-dim',
  },
  status_change: {
    dot: 'bg-warning',
    badge: 'text-warning bg-[color-mix(in_srgb,var(--warning)_14%,transparent)]',
  },
  linkage_impact: {
    dot: 'bg-ai',
    badge: 'text-ai bg-[color-mix(in_srgb,var(--ai)_12%,transparent)]',
  },
  discard: {
    dot: 'bg-draft-gray',
    badge: 'text-draft-gray bg-[color-mix(in_srgb,var(--draft-gray)_12%,transparent)]',
  },
  delete: {
    dot: 'bg-danger',
    badge: 'text-danger bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]',
  },
};

/** Unix 毫秒 → 'YYYY-MM-DD HH:mm'(本地时区;手工 pad 避免 SSR/浏览器 locale 差异) */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 快照里安全取 title/status(change_logs 快照为 jsonb,结构随实体类型而异) */
function snapshotField(snapshot: unknown, field: string): string | undefined {
  if (snapshot && typeof snapshot === 'object' && field in snapshot) {
    const v = (snapshot as Record<string, unknown>)[field];
    return typeof v === 'string' ? v : undefined;
  }
  return undefined;
}

/**
 * P4 变更历史时间线:竖线 + 类型圆点,每条 = changeType 徽章 + 快照标题 +
 * 状态流转(from → to)+ reason + 时间;linkage_impact 条目带紫色微光。
 */
export function HistoryTimeline({ changeLogs }: { changeLogs: ChangeLogRow[] }) {
  const t = useTranslations('pointDetail');
  const tBadge = useTranslations('shared.badge');

  if (changeLogs.length === 0) {
    return <p className="text-sm text-text-muted">{t('historyEmpty')}</p>;
  }

  return (
    <ol className="relative space-y-5 border-l border-border pl-5">
      {changeLogs.map((log) => {
        const style = CHANGE_STYLE[log.changeType] ?? CHANGE_STYLE.update;
        const title = snapshotField(log.afterSnapshot, 'title');
        const beforeStatus = snapshotField(log.beforeSnapshot, 'status');
        const afterStatus = snapshotField(log.afterSnapshot, 'status');
        const statusFlow =
          beforeStatus && afterStatus && beforeStatus !== afterStatus
            ? { from: beforeStatus, to: afterStatus }
            : null;
        const isLinkage = log.changeType === 'linkage_impact';

        return (
          <li key={log.id} className="relative">
            <span
              aria-hidden
              style={
                isLinkage
                  ? { boxShadow: '0 0 6px 1px color-mix(in srgb, var(--ai) 55%, transparent)' }
                  : undefined
              }
              className={`absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${style.dot}`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${style.badge}`}
              >
                {t(`changeType.${log.changeType}`)}
              </span>
              {title && <span className="text-sm text-text-primary">{title}</span>}
              <time className="ml-auto text-xs tabular-nums text-text-muted">
                {formatTime(log.createdAt)}
              </time>
            </div>
            {statusFlow && (
              <p className="mt-1 flex items-center gap-1 text-xs text-text-secondary">
                {tBadge(`badge.${statusFlow.from}`)}
                <svg
                  viewBox="0 0 24 24"
                  className="h-3 w-3 text-text-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
                {tBadge(`badge.${statusFlow.to}`)}
              </p>
            )}
            {log.reason && (
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                {t('historyReason', { reason: log.reason })}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
