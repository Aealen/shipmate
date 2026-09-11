'use client';

import type { RequirementPointRow } from '@shipmate/core';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/shared/badge';
import { Modal } from '@/components/shared/modal';

/**
 * P3b 原文依据弹窗:展示需求点的 evidences 列表(素材标题 + 原文引用块)。
 * evidences 为空时展示黄条「无原文依据,需人工校验」,提示人工补充判断依据。
 * point 由父组件在关闭动画期间保留(父级持有点数据、单独控制 open),
 * 关闭时内容不闪空。
 */
export function EvidenceModal({
  open,
  onClose,
  point,
  materialTitles,
}: {
  open: boolean;
  onClose: () => void;
  point: RequirementPointRow | null;
  /** materialId → 素材标题;查不到(素材未命名/已删)时回退显示短 id */
  materialTitles: Record<string, string>;
}) {
  const t = useTranslations('browse');
  if (!point) return null;

  const evidences = point.evidences ?? [];

  return (
    <Modal open={open} onClose={onClose} title={t('evidenceTitle')}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-text-primary">
          {point.title}
        </span>
        <StatusBadge status={point.status} size="sm" />
        <span className="ml-auto shrink-0 text-xs text-text-muted">v{point.version}</span>
      </div>

      {evidences.length === 0 ? (
        <p className="mt-4 rounded-lg bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] px-3 py-2.5 text-sm text-warning">
          {t('noEvidence')}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {evidences.map((e, i) => (
            <li
              key={`${e.material_id}-${i}`}
              className="rounded-lg border border-border bg-surface-2 p-3"
            >
              <p className="truncate text-xs text-text-muted">
                {materialTitles[e.material_id] ?? `#${e.material_id.slice(0, 8)}`}
              </p>
              <blockquote className="mt-1.5 border-l-2 border-accent pl-2.5 text-sm leading-relaxed text-text-primary">
                {e.quote}
              </blockquote>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
