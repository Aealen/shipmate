'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { StatusBadge, type BadgeStatus } from '@/components/shared/badge';
import { Modal } from '@/components/shared/modal';

/** 对比侧数据:草稿点(LLM 产出,无落库状态)或已有点(带实时状态) */
export interface ConflictCompareSide {
  title: string;
  description?: string | null;
  status?: BadgeStatus | null;
}

/**
 * P3e 冲突对比弹窗(可复用):草稿需求点 vs 已有需求点左右对照。
 * 裁决动作(相悖:用新/用旧/都保留;重复:并入/仍要新建)不耦合在本组件,
 * 由调用方(如 P3c 工作台)经 children 传入动作区,提交逻辑归调用方。
 */
export function ConflictCompareModal({
  open,
  onClose,
  conflictType,
  reason,
  draft,
  existing,
  children,
}: {
  open: boolean;
  onClose: () => void;
  conflictType: 'contradiction' | 'duplicate';
  /** AI 给出的冲突说明,可空 */
  reason?: string | null;
  draft: ConflictCompareSide;
  existing: ConflictCompareSide;
  /** 裁决动作区(调用方的三选一按钮组),可空 */
  children?: ReactNode;
}) {
  const t = useTranslations('browse');

  return (
    <Modal open={open} onClose={onClose} title={t('conflictTitle')}>
      <p className="text-sm font-medium text-text-primary">
        {conflictType === 'contradiction' ? t('conflictContradiction') : t('conflictDuplicate')}
      </p>
      {reason ? (
        <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
          <span className="text-warning">⚡ </span>
          {t('conflictReasonLabel')}:{reason}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SideCard label={t('draftSide')} side={draft} isDraft />
        <SideCard label={t('existingSide')} side={existing} />
      </div>

      {children ? <div className="mt-4 border-t border-border pt-3">{children}</div> : null}
    </Modal>
  );
}

/** 单侧对比卡:草稿侧虚线边框区分;无状态时按草稿徽章展示 */
function SideCard({
  label,
  side,
  isDraft = false,
}: {
  label: string;
  side: ConflictCompareSide;
  isDraft?: boolean;
}) {
  const t = useTranslations('browse');

  return (
    <div
      className={`rounded-lg border border-border bg-surface-2 p-3 ${isDraft ? 'border-dashed' : ''}`}
    >
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1.5 text-sm font-medium leading-snug text-text-primary">{side.title}</p>
      {side.description ? (
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">{side.description}</p>
      ) : (
        <p className="mt-1 text-xs text-text-muted">{t('noDescription')}</p>
      )}
      <div className="mt-2">
        <StatusBadge status={side.status ?? 'draft'} size="sm" />
      </div>
    </div>
  );
}
