'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { suggestMergeFromContentsAction } from '@/actions/analysis';
import { showToast } from '@/components/shared/toast';

/**
 * P3n/P3n2 工作台草稿合并弹窗(三栏,spec §9 规则 9b):
 * kind='point' 合并同块多个需求点(左:点清单/中:单点参照/右:标题+描述);
 * kind='block' 合并多个草稿块(左:块清单/中:块摘要+点列表参照/右:标题+摘要+归并点预览)。
 * 「智能合并」走 suggestMergeFromContents(内容级,不落库),回填后可二次编辑;
 * 确认由父级在前端重组草稿 state(工作台草稿未落库,应用时整体写回)。
 */

/** spec §14:弹窗开关动画 120ms(同 shared/modal) */
const ANIM_MS = 120;

export interface MergePointItem {
  title: string;
  description: string;
  evidenceCount: number;
}

export interface MergeBlockItem {
  title: string;
  summary: string;
  points: { title: string; description: string }[];
}

export function MergeDraftModal({
  open,
  onClose,
  onConfirm,
  kind,
  points = [],
  blocks = [],
}: {
  open: boolean;
  onClose: () => void;
  /** 确认合并:回传编辑后的内容,父级重组草稿 state */
  onConfirm: (result: { title: string; description?: string; summary?: string }) => void;
  kind: 'point' | 'block';
  points?: MergePointItem[];
  blocks?: MergeBlockItem[];
}) {
  const t = useTranslations('analysis.merge');
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [viewingIndex, setViewingIndex] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [summary, setSummary] = useState('');
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    if (open) {
      setViewingIndex(0);
      setTitle('');
      setDescription('');
      setSummary('');
      setMounted(true);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setShown(false);
      const timer = setTimeout(() => setMounted(false), ANIM_MS);
      return () => clearTimeout(timer);
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /** 块模式的归并点预览:按 title 去重,顺次拼接 */
  const mergedPoints = useMemo(() => {
    if (kind !== 'block') return [];
    const seen = new Set<string>();
    const list: { title: string; description: string }[] = [];
    for (const b of blocks) {
      for (const p of b.points) {
        if (seen.has(p.title)) continue;
        seen.add(p.title);
        list.push(p);
      }
    }
    return list;
  }, [kind, blocks]);

  async function suggest() {
    if (suggesting) return;
    setSuggesting(true);
    const items =
      kind === 'point'
        ? points.map((p) => ({ title: p.title, description: p.description }))
        : blocks.map((b) => ({ title: b.title, description: b.summary }));
    const res = await suggestMergeFromContentsAction(kind, items);
    setSuggesting(false);
    if (res.ok) {
      setTitle(res.data.title);
      if (kind === 'point') setDescription(res.data.description ?? '');
      else setSummary(res.data.summary ?? '');
      showToast(t('suggestDone'));
    } else {
      showToast(res.message, 'error');
    }
  }

  function confirm() {
    if (!title.trim()) return;
    if (kind === 'point') onConfirm({ title: title.trim(), description: description.trim() });
    else onConfirm({ title: title.trim(), summary: summary.trim() });
  }

  if (!mounted) return null;

  const itemCount = kind === 'point' ? points.length : blocks.length;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-[120ms] ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={kind === 'point' ? t('pointTitle') : t('blockTitle')}
        className={`relative flex h-[80vh] w-[1080px] max-w-[95vw] flex-col rounded-[12px] bg-surface p-[22px] shadow-xl transition-all duration-[120ms] ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        }`}
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-accent-dim text-[13px] text-accent">
            ⇉
          </span>
          <h2 className="text-[17px] font-bold tracking-tight text-text-primary">
            {kind === 'point' ? t('pointTitle') : t('blockTitle')}
          </h2>
          <span className="text-xs text-text-muted">
            {kind === 'point' ? t('pointSubtitle', { count: itemCount }) : t('blockSubtitle', { count: itemCount })}
          </span>
          <span className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] text-text-secondary transition-colors duration-[80ms] hover:text-text-primary"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="mt-3 h-px shrink-0 bg-border" />

        {/* 三栏 */}
        <div className="mt-3.5 flex min-h-0 flex-1 gap-3.5">
          {/* 左:已选清单 */}
          <div className="flex w-[240px] shrink-0 flex-col gap-2 overflow-y-auto">
            <p className="shrink-0 text-xs font-bold text-text-secondary">
              {kind === 'point' ? t('selectedPoints', { count: itemCount }) : t('selectedBlocks', { count: itemCount })}
            </p>
            {kind === 'point'
              ? points.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setViewingIndex(i)}
                    className={`rounded-lg border p-2.5 text-left transition-colors duration-[80ms] ${
                      i === viewingIndex
                        ? 'border-accent bg-accent-dim'
                        : 'border-border bg-surface hover:border-accent/60'
                    }`}
                  >
                    <span className="line-clamp-2 text-xs font-bold text-text-primary">{p.title}</span>
                  </button>
                ))
              : blocks.map((b, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setViewingIndex(i)}
                    className={`flex flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left transition-colors duration-[80ms] ${
                      i === viewingIndex
                        ? 'border-accent bg-accent-dim'
                        : 'border-border bg-surface hover:border-accent/60'
                    }`}
                  >
                    <span className="line-clamp-2 text-xs font-bold text-text-primary">{b.title}</span>
                    <span className="text-[10.5px] text-text-muted">
                      {t('pointsCount', { count: b.points.length })}
                    </span>
                  </button>
                ))}
          </div>

          {/* 中:详情参照 */}
          <div className="flex w-[320px] shrink-0 flex-col gap-2 overflow-y-auto rounded-[10px] border border-border bg-surface p-3">
            <p className="shrink-0 text-xs font-bold text-text-secondary">{t('reference')}</p>
            {kind === 'point' ? (
              <>
                <p className="shrink-0 text-sm font-bold text-text-primary">
                  {points[viewingIndex]?.title}
                </p>
                <p className="text-xs leading-relaxed text-text-secondary">
                  {points[viewingIndex]?.description || t('descriptionEmpty')}
                </p>
                {(points[viewingIndex]?.evidenceCount ?? 0) > 0 && (
                  <p className="mt-1 shrink-0 text-[11px] text-text-muted">
                    {t('evidences', { count: points[viewingIndex].evidenceCount })}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="shrink-0 text-sm font-bold text-text-primary">
                  {blocks[viewingIndex]?.title}
                </p>
                <p className="shrink-0 text-[11px] text-text-muted">{t('summaryLabel')}</p>
                <p className="text-xs leading-relaxed text-text-secondary">
                  {blocks[viewingIndex]?.summary || t('descriptionEmpty')}
                </p>
                <p className="mt-1 shrink-0 text-[11px] text-text-muted">
                  {t('pointsCount', { count: blocks[viewingIndex]?.points.length ?? 0 })}
                </p>
                {(blocks[viewingIndex]?.points ?? []).map((p, i) => (
                  <div key={i} className="rounded-md bg-surface-2/60 px-2.5 py-1.5">
                    <p className="flex items-center gap-1.5">
                      <span className="inline-flex shrink-0 items-center rounded-[4px] bg-[color-mix(in_srgb,var(--draft-gray)_10%,transparent)] px-[5px] py-[2px] text-[9px] font-medium leading-none text-draft-gray">
                        draft
                      </span>
                      <span className="min-w-0 truncate text-xs font-medium text-text-primary">
                        {p.title}
                      </span>
                    </p>
                    {p.description && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-text-secondary">
                        {p.description}
                      </p>
                    )}
                  </div>
                ))}
              </>
            )}
            <span className="min-h-4 flex-1" />
            <p className="shrink-0 text-[10.5px] text-text-muted">{t('mergeHint')}</p>
          </div>

          {/* 右:合并编辑 */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[10px] border border-border bg-surface p-3">
            <div className="flex shrink-0 items-center gap-2">
              <p className="text-xs font-bold text-text-secondary">{t('result')}</p>
              <span className="min-w-0 flex-1" />
              <button
                type="button"
                onClick={suggest}
                disabled={suggesting}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-dim px-3 text-xs font-bold text-accent transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
              >
                ✨ {suggesting ? t('suggesting') : t('suggest')}
              </button>
            </div>
            <label htmlFor="merge-draft-title" className="shrink-0 text-[11px] text-text-muted">
              {kind === 'point' ? t('mergedTitle') : t('mergedBlockTitle')}
            </label>
            <input
              id="merge-draft-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('titlePlaceholder')}
              className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
            />
            {kind === 'point' ? (
              <>
                <label htmlFor="merge-draft-desc" className="shrink-0 text-[11px] text-text-muted">
                  {t('mergedDescription')}
                </label>
                <textarea
                  id="merge-draft-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('descriptionPlaceholder')}
                  rows={8}
                  className="min-h-0 w-full flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
                />
              </>
            ) : (
              <>
                <label htmlFor="merge-draft-summary" className="shrink-0 text-[11px] text-text-muted">
                  {t('mergedSummary')}
                </label>
                <textarea
                  id="merge-draft-summary"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder={t('summaryPlaceholder')}
                  rows={3}
                  className="shrink-0 resize-none rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
                />
                <p className="shrink-0 text-[11px] text-text-muted">
                  {t('mergedPointsPreview', { count: mergedPoints.length })}
                </p>
                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                  {mergedPoints.map((p, i) => (
                    <p key={i} className="flex items-center gap-1.5 rounded-md bg-surface-2/60 px-2.5 py-1.5">
                      <span className="inline-flex shrink-0 items-center rounded-[4px] bg-[color-mix(in_srgb,var(--draft-gray)_10%,transparent)] px-[5px] py-[2px] text-[9px] font-medium leading-none text-draft-gray">
                        draft
                      </span>
                      <span className="min-w-0 truncate text-xs text-text-primary">{p.title}</span>
                    </p>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 底部 */}
        <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-border pt-3">
          <p className="text-[10.5px] text-text-muted">{t('footHint')}</p>
          <span className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg border border-border px-4 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            {t('close')}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!title.trim()}
            className="h-8 rounded-full bg-accent px-5 text-xs font-bold text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {kind === 'point' ? t('confirmPoint') : t('confirmBlock')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
