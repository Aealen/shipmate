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
 * P3c 左栏(原型加强版结构):透明分区直接坐暖纸底——素材卡为白底 hairline 边框卡,
 * 「新增素材」为白底卡(类型 pill 组),底部开始分析。
 * 素材卡点击打开详情 Modal(原型 P3m/P3m2),✏ 直达编辑态;写操作经 workbench 回调。
 */
export function MaterialPanel({
  materials,
  runStatus,
  runError,
  analyzing,
  onStart,
  onAdd,
  onOpen,
}: {
  materials: MaterialRow[];
  runStatus: 'pending' | 'done' | 'failed' | null;
  /** 分析失败摘要(spec §3.2 run.error);null = 旧失败数据,横幅维持现状文案 */
  runError: string | null;
  analyzing: boolean;
  onStart: () => void;
  onAdd: (input: {
    type: MaterialRow['type'];
    title: string;
    rawContent: string;
  }) => Promise<boolean>;
  /** 打开素材详情 Modal(edit = 直达编辑态;Modal 内保存走 workbench onUpdate) */
  onOpen: (material: MaterialRow, edit?: boolean) => void;
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
    <section className="flex min-h-0 w-[380px] shrink-0 flex-col">
      <header className="flex shrink-0 items-center justify-between px-1 pb-3">
        <h2 className="text-[15px] font-bold tracking-tight text-text-primary">
          {t('materialSection')}
        </h2>
        <span className="text-xs text-text-muted">
          {t('materialCount', { count: materials.length })}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {materials.length === 0 ? (
          <EmptyState title={t('materialEmptyTitle')} description={t('materialEmptyDesc')} />
        ) : (
          <ul className="space-y-2">
            {materials.map((m) => (
              <MaterialCard key={m.id} material={m} onOpen={onOpen} />
            ))}
          </ul>
        )}
        {runStatus === 'failed' && (
          <div className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2">
            <p className="text-xs text-danger">{t('analysisFailedState')}</p>
            {/* 失败原因摘要:截断两行,悬停看全文;旧失败数据无摘要时只显示提示行 */}
            {runError && (
              <p
                className="mt-1 line-clamp-2 break-all text-[11px] leading-snug text-danger"
                title={runError}
              >
                {runError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 新增素材:白底 + hairline 边框卡(原型 Add Material Box),类型为 pill 组 */}
      <div className="shrink-0 rounded-[14px] border border-border bg-surface p-4">
        <p className="text-xs font-semibold text-text-secondary">{t('addMaterial.title')}</p>
        <div className="mt-2.5 flex gap-1.5" role="radiogroup" aria-label={t('addMaterial.type')}>
          {MATERIAL_TYPES.map((v) => {
            const active = v === type;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setType(v)}
                className={`h-7 rounded-full border px-3 text-xs transition-colors duration-[80ms] ${
                  active
                    ? 'border-transparent bg-accent-dim font-medium text-accent'
                    : 'border-border text-text-secondary hover:text-text-primary'
                }`}
              >
                {t(`materialType.${v}`)}
              </button>
            );
          })}
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('addMaterial.materialTitle')}
          className={`${FIELD_INPUT} mt-2 h-8`}
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t('addMaterial.contentPlaceholder')}
          rows={3}
          className={`${FIELD_INPUT} mt-2 resize-y py-1.5`}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={!content.trim() || adding}
            className="h-8 rounded-full bg-accent px-3.5 text-xs font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {adding ? t('addMaterial.submitting') : t('addMaterial.submit')}
          </button>
        </div>
      </div>

      <div className="shrink-0 pb-1 pt-3">
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-accent text-sm font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SparkIcon spinning={analyzing} />
          {analyzing ? t('analyzing') : t('startAnalysis')}
        </button>
      </div>
    </section>
  );
}

/**
 * 单张素材卡:白底 + hairline 边框点缀,hover 微阴影;整卡点击打开详情 Modal,
 * hover 出 ✏ 直达编辑态(原型 P3m/P3m2)。展示为类型 pill + 标题 + 两行摘要。
 */
function MaterialCard({
  material,
  onOpen,
}: {
  material: MaterialRow;
  onOpen: (material: MaterialRow, edit?: boolean) => void;
}) {
  const t = useTranslations('analysis');

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onOpen(material)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(material);
      }}
      className="group cursor-pointer rounded-lg border border-border bg-surface p-3 outline-none transition-all duration-[120ms] hover:shadow-sm focus-visible:border-accent"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center rounded-full bg-accent-dim px-2 py-0.5 text-[11px] font-medium text-accent">
          {t(`materialType.${material.type}`)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
          {material.title || t('materialUntitled')}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(material, true);
          }}
          aria-label={t('materialEdit')}
          title={t('materialEdit')}
          className="flex shrink-0 items-center rounded px-1 py-0.5 text-[11px] text-text-secondary opacity-0 transition-all duration-[80ms] hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M14.5 5.5l4 4L8 20H4v-4z" />
            <path d="M12.5 7.5l4 4" />
          </svg>
        </button>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{material.rawContent}</p>
    </li>
  );
}
