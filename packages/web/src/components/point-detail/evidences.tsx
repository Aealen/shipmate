'use client';

import { useTranslations } from 'next-intl';
import type { Evidence } from '@shipmate/core';

/**
 * P4 溯源依据:每条 = 素材标题 + AI 引用原文块(左侧 accent 竖线 + surface-2 底)。
 * spec §3.5:无 evidences 的需求点必须提示人工校验,不能默认可信。
 */
export function Evidences({
  evidences,
  materialTitles,
}: {
  evidences: Evidence[];
  materialTitles: Record<string, string | null>;
}) {
  const t = useTranslations('pointDetail');

  if (evidences.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-dashed border-warning/60 bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2.5">
        <svg
          viewBox="0 0 24 24"
          className="mt-0.5 h-4 w-4 shrink-0 text-warning"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
        <p className="text-sm text-text-secondary">{t('noEvidences')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {evidences.map((ev, i) => (
        <div key={`${ev.material_id}-${i}`}>
          <p className="text-xs text-text-muted">
            {materialTitles[ev.material_id] === undefined
              ? t('materialMissing')
              : (materialTitles[ev.material_id] ?? t('materialUntitled'))}
          </p>
          <blockquote className="mt-1 rounded-r-md border-l-2 border-accent bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-text-secondary">
            {ev.quote}
          </blockquote>
        </div>
      ))}
    </div>
  );
}
