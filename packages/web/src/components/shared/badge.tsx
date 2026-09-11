'use client';

import { useTranslations } from 'next-intl';

/** 状态徽章枚举:覆盖需求点/任务/分析批次/项目分组的全部 status 值 */
export type BadgeStatus =
  | 'draft'
  | 'confirmed'
  | 'developing'
  | 'done'
  | 'needs_reassessment'
  | 'pending'
  | 'failed'
  | 'archived'
  | 'active';

export type BadgeSize = 'sm' | 'md';

/**
 * 计划配色表(Global Constraints):draft=draft-gray、confirmed=accent、
 * developing=warning、done=success、needs_reassessment=danger、failed=danger、
 * pending=text-muted、archived=muted;active 不在表内(分组/项目启用态),
 * 取 success 表示正常活跃。底色用 color-mix 取 token 的 12% 透明度,随主题联动。
 */
const STATUS_STYLES: Record<BadgeStatus, { badge: string; dot: string }> = {
  draft: {
    badge: 'bg-[color-mix(in_srgb,var(--draft-gray)_12%,transparent)] text-draft-gray',
    dot: 'bg-draft-gray',
  },
  confirmed: {
    badge: 'bg-accent-dim text-accent',
    dot: 'bg-accent',
  },
  developing: {
    badge: 'bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-warning',
    dot: 'bg-warning',
  },
  done: {
    badge: 'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success',
    dot: 'bg-success',
  },
  needs_reassessment: {
    badge: 'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger',
    dot: 'bg-danger',
  },
  failed: {
    badge: 'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger',
    dot: 'bg-danger',
  },
  pending: {
    badge: 'bg-[color-mix(in_srgb,var(--text-muted)_12%,transparent)] text-text-muted',
    dot: 'bg-text-muted',
  },
  archived: {
    badge: 'bg-[color-mix(in_srgb,var(--text-muted)_12%,transparent)] text-text-muted',
    dot: 'bg-text-muted',
  },
  active: {
    badge: 'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success',
    dot: 'bg-success',
  },
};

const SIZE_STYLES: Record<BadgeSize, string> = {
  sm: 'gap-1 px-1.5 text-[11px]',
  md: 'gap-1.5 px-2 text-xs',
};

/**
 * 通用状态徽章:圆点 + 状态名,颜色按计划配色表映射。
 * 状态文案走 shared.badge.* 翻译键。
 */
export function StatusBadge({
  status,
  size = 'md',
}: {
  status: BadgeStatus;
  size?: BadgeSize;
}) {
  const t = useTranslations('shared');
  const s = STATUS_STYLES[status];

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full py-0.5 font-medium ${SIZE_STYLES[size]} ${s.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {t(`badge.${status}`)}
    </span>
  );
}

/** 超期专属徽章:红底「已超期 N 天」(P3/P5b 超期清单用) */
export function OverdueBadge({ days }: { days: number }) {
  const t = useTranslations('shared');

  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-danger px-2 py-0.5 text-xs font-medium text-white">
      {t('overdueDays', { days })}
    </span>
  );
}

/** 临期徽章:黄底「即将到期」 */
export function DueSoonBadge() {
  const t = useTranslations('shared');

  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-warning px-2 py-0.5 text-xs font-medium text-white">
      {t('dueSoon')}
    </span>
  );
}
