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
  | 'in_progress'
  | 'failed'
  | 'archived'
  | 'active';

export type BadgeSize = 'sm' | 'md';

/**
 * 计划配色表(Global Constraints):draft=draft-gray、confirmed=accent、
 * developing=warning、done=success、needs_reassessment=danger、failed=danger、
 * pending=text-muted、archived=muted;active 不在表内(分组/项目启用态),
 * 取 success 表示正常活跃。
 * 形态:淡语义色底(color-mix 10%)+ 同色彩字,替代原先的统一灰底——
 * 灰底徽章满屏时无视觉重点,淡彩底让状态语义一眼可辨(draft 灰/confirmed 蓝/developing 黄/done 绿)。
 */
const STATUS_STYLES: Record<BadgeStatus, string> = {
  draft: 'bg-[color-mix(in_srgb,var(--draft-gray)_10%,transparent)] text-draft-gray',
  confirmed: 'bg-accent-dim text-accent',
  developing: 'bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-warning',
  done: 'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success',
  needs_reassessment: 'bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-danger',
  failed: 'bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-danger',
  pending: 'bg-[color-mix(in_srgb,var(--text-muted)_10%,transparent)] text-text-muted',
  in_progress: 'bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-warning',
  archived: 'bg-[color-mix(in_srgb,var(--text-muted)_10%,transparent)] text-text-muted',
  active: 'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success',
};

const SIZE_STYLES: Record<BadgeSize, string> = {
  sm: 'px-[5px] py-[2px] text-[9px]',
  md: 'px-[6px] py-[2px] text-[10px]',
};

/**
 * 通用状态徽章:淡语义色底小方徽 + 状态名,颜色按计划配色表映射。
 * 状态文案走 shared.badge.* 翻译键。
 */
export function StatusBadge({ status, size = 'md' }: { status: BadgeStatus; size?: BadgeSize }) {
  const t = useTranslations('shared');

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[4px] font-medium leading-none ${SIZE_STYLES[size]} ${STATUS_STYLES[status]}`}
    >
      {t(`badge.${status}`)}
    </span>
  );
}

/** 超期专属徽章:红底白字「已超期 N 天」(P3/P5b 超期清单用,原型 P3 帧) */
export function OverdueBadge({ days }: { days: number }) {
  const t = useTranslations('shared');

  return (
    <span className="inline-flex shrink-0 items-center rounded-[5px] bg-danger px-2 py-[3px] text-[10px] font-bold leading-none text-white">
      {t('overdueDays', { days })}
    </span>
  );
}

/** 临期徽章:黄底白字「即将到期」 */
export function DueSoonBadge() {
  const t = useTranslations('shared');

  return (
    <span className="inline-flex shrink-0 items-center rounded-[5px] bg-warning px-2 py-[3px] text-[10px] font-bold leading-none text-white">
      {t('dueSoon')}
    </span>
  );
}
