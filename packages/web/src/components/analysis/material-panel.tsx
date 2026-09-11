'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { MaterialRow } from '@shipmate/core';
import { EmptyState } from '@/components/shared/empty-state';

const MATERIAL_TYPES = ['paste_text', 'screenshot_text', 'doc'] as const;

/** ✦ 四角星(spec §14:分析按钮 loading 时旋转) */
function SparkIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`}
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
    </svg>
  );
}

const FIELD_INPUT =
  'w-full rounded-md border border-border bg-surface px-2.5 text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent';

/**
 * P3c 左栏:本批素材列表 + 底部「新增素材」边框区 + 最底「开始分析」。
 * 写操作经 workbench 下发的回调(onAdd/onStart),本组件只管表单与展示。
 */
export function MaterialPanel({
  materials,
  runStatus,
  analyzing,
  onStart,
  onAdd,
}: {
  materials: MaterialRow[];
  runStatus: 'pending' | 'done' | 'failed' | null;
  analyzing: boolean;
  onStart: () => void;
  onAdd: (input: {
    type: MaterialRow['type'];
    title: string;
    rawContent: string;
  }) => Promise<boolean>;
}) {
  const t = useTranslations('analysis');
  const [type, setType] = useState<MaterialRow['type']>('paste_text');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [adding, setAdding] = useState(false);
  const canStart = materials.length > 0 && !analyzing;

  async function submit() {
    if (!content.trim() || adding) return;
    setAdding(true);
    const ok = await onAdd({ type, title: title.trim(), rawContent: content });
    setAdding(false);
    if (ok) {
      setTitle('');
      setContent('');
    }
  }

  return (
    <section className="flex min-h-0 w-[380px] shrink-0 flex-col rounded-xl border border-border bg-surface">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">{t('materialSection')}</h2>
        <span className="text-xs text-text-muted">
          {t('materialCount', { count: materials.length })}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {materials.length === 0 ? (
          <EmptyState title={t('materialEmptyTitle')} description={t('materialEmptyDesc')} />
        ) : (
          <ul className="space-y-2">
            {materials.map((m) => (
              <li
                key={m.id}
                className="rounded-lg border border-border p-3 transition-colors duration-[120ms] hover:border-accent"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex shrink-0 items-center rounded-full bg-accent-dim px-2 py-0.5 text-[11px] font-medium text-accent">
                    {t(`materialType.${m.type}`)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                    {m.title || t('materialUntitled')}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{m.rawContent}</p>
              </li>
            ))}
          </ul>
        )}
        {runStatus === 'failed' && (
          <p className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-xs text-danger">
            {t('analysisFailedState')}
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-4">
        <p className="text-xs font-semibold text-text-secondary">{t('addMaterial.title')}</p>
        <div className="mt-2 space-y-2 rounded-lg border border-dashed border-border p-3">
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MaterialRow['type'])}
              aria-label={t('addMaterial.type')}
              className={`${FIELD_INPUT} h-8 shrink-0`}
            >
              {MATERIAL_TYPES.map((v) => (
                <option key={v} value={v}>
                  {t(`materialType.${v}`)}
                </option>
              ))}
            </select>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('addMaterial.materialTitle')}
              className={`${FIELD_INPUT} h-8 min-w-0 flex-1`}
            />
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('addMaterial.contentPlaceholder')}
            rows={3}
            className={`${FIELD_INPUT} resize-y py-1.5`}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={!content.trim() || adding}
              className="h-8 rounded-md bg-accent px-3.5 text-xs font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adding ? t('addMaterial.submitting') : t('addMaterial.submit')}
            </button>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-4">
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-ai text-sm font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SparkIcon spinning={analyzing} />
          {analyzing ? t('analyzing') : t('startAnalysis')}
        </button>
      </div>
    </section>
  );
}
