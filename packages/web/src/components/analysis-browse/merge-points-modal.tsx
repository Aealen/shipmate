'use client';

import type { RequirementPointRow } from '@shipmate/core';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  mergeRequirementPointsAction,
  suggestPointMergeAction,
} from '@/actions/points';
import { showToast } from '@/components/shared/toast';

/**
 * P3n 需求点合并弹窗(三栏,spec §9 规则 9b):
 * 左 = 已选需求点清单(点击切换中栏参照);中 = 所选点详情与溯源依据;
 * 右 = 合并编辑(归入需求/标题/描述)+「智能合并」(LLM 生成回填,可二次编辑,不落库)。
 * 确认合并走 mergeRequirementPoints:新点落目标需求,被并点及其任务删除留痕。
 */

/** spec §14:弹窗开关动画 120ms(同 shared/modal) */
const ANIM_MS = 120;

export function MergePointsModal({
  open,
  onClose,
  onMerged,
  points,
  requirements,
}: {
  open: boolean;
  onClose: () => void;
  /** 合并成功后回调(父级清空勾选集;取消不触发) */
  onMerged: () => void;
  /** 已选需求点(≥2,父级保证) */
  points: RequirementPointRow[];
  /** 可归入的需求(项目全量;默认第一点所属需求) */
  requirements: { id: string; title: string }[];
}) {
  const t = useTranslations('browse.merge');
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [requirementId, setRequirementId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [merging, setMerging] = useState(false);

  // 打开时重置:参照默认第一点,归入需求默认第一点所属需求,表单留空(供手写或智能填充)
  useEffect(() => {
    if (open) {
      setViewingId(points[0]?.id ?? null);
      setRequirementId(points[0]?.requirementId ?? requirements[0]?.id ?? '');
      setTitle('');
      setDescription('');
      setMounted(true);
    }
    // points/requirements 由父级在打开期间保证稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const viewing = useMemo(
    () => points.find((p) => p.id === viewingId) ?? points[0] ?? null,
    [points, viewingId],
  );
  const evidenceQuotes = useMemo(
    () => (viewing?.evidences ?? []).slice(0, 4).map((e) => e.quote),
    [viewing],
  );

  async function suggest() {
    if (suggesting) return;
    setSuggesting(true);
    const res = await suggestPointMergeAction(points.map((p) => p.id));
    setSuggesting(false);
    if (res.ok) {
      setTitle(res.data.title);
      setDescription(res.data.description);
      showToast(t('suggestDone'));
    } else {
      showToast(res.message, 'error');
    }
  }

  async function confirm() {
    if (merging || !title.trim() || !requirementId) return;
    setMerging(true);
    const res = await mergeRequirementPointsAction(
      points.map((p) => p.id),
      { requirementId, title: title.trim(), description: description.trim() || undefined },
    );
    setMerging(false);
    if (res.ok) {
      showToast(t('mergedDone', { count: points.length }));
      onMerged();
      onClose();
    } else {
      showToast(res.message, 'error');
    }
  }

  if (!mounted) return null;

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
        aria-label={t('title')}
        className={`relative flex h-[82vh] w-[1100px] max-w-[95vw] flex-col rounded-[12px] bg-surface p-[22px] shadow-xl transition-all duration-[120ms] ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        }`}
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-accent-dim text-[13px] text-accent">
            ⇉
          </span>
          <h2 className="text-[17px] font-bold tracking-tight text-text-primary">{t('title')}</h2>
          <span className="text-xs text-text-muted">
            {t('subtitle', { count: points.length })}
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
              {t('selectedList', { count: points.length })}
            </p>
            {points.map((p) => {
              const active = p.id === viewing?.id;
              const reqTitle =
                requirements.find((r) => r.id === p.requirementId)?.title ?? '';
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setViewingId(p.id)}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left transition-colors duration-[80ms] ${
                    active
                      ? 'border-accent bg-accent-dim'
                      : 'border-border bg-surface hover:border-accent/60'
                  }`}
                >
                  <span className="line-clamp-2 text-xs font-bold text-text-primary">
                    {p.title}
                  </span>
                  {reqTitle && (
                    <span className="line-clamp-1 text-[10.5px] text-text-muted">{reqTitle}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 中:详情参照 */}
          <div className="flex w-[300px] shrink-0 flex-col gap-2 overflow-y-auto rounded-[10px] border border-border bg-surface p-3">
            <p className="shrink-0 text-xs font-bold text-text-secondary">{t('reference')}</p>
            {viewing ? (
              <>
                <p className="shrink-0 text-sm font-bold text-text-primary">{viewing.title}</p>
                <p className="shrink-0 text-[11px] text-text-muted">{t('description')}</p>
                <p className="text-xs leading-relaxed text-text-secondary">
                  {viewing.description || t('descriptionEmpty')}
                </p>
                <p className="mt-1 shrink-0 text-[11px] text-text-muted">
                  {t('evidences', { count: viewing.evidences?.length ?? 0 })}
                </p>
                {evidenceQuotes.map((q, i) => (
                  <blockquote
                    key={i}
                    className="rounded-md bg-surface-2 px-2.5 py-1.5 text-[11px] leading-relaxed text-text-secondary"
                  >
                    「{q}」
                  </blockquote>
                ))}
              </>
            ) : (
              <p className="text-xs text-text-muted">{t('referenceEmpty')}</p>
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
            <label htmlFor="merge-req" className="shrink-0 text-[11px] text-text-muted">
              {t('targetRequirement')}
            </label>
            <select
              id="merge-req"
              value={requirementId}
              onChange={(e) => setRequirementId(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-text-primary outline-none transition-colors focus:border-accent"
            >
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
            <label htmlFor="merge-title" className="shrink-0 text-[11px] text-text-muted">
              {t('mergedTitle')}
            </label>
            <input
              id="merge-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('mergedTitlePlaceholder')}
              className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
            />
            <label htmlFor="merge-desc" className="shrink-0 text-[11px] text-text-muted">
              {t('mergedDescription')}
            </label>
            <textarea
              id="merge-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('mergedDescriptionPlaceholder')}
              rows={8}
              className="min-h-0 w-full flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
            />
          </div>
        </div>

        {/* 底部 */}
        <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-border pt-3">
          <p className="text-[10.5px] text-text-muted">{t('footHint')}</p>
          <span className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={merging}
            className="h-8 rounded-lg border border-border px-4 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('close')}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={merging || !title.trim() || !requirementId}
            className="h-8 rounded-full bg-accent px-5 text-xs font-bold text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {merging ? t('merging') : t('confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
