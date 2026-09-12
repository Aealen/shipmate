'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { DraftBlockState, DraftRevisionView } from '@/components/analysis/draft-block';
import { toPointState } from '@/components/analysis/draft-block';
import {
  reviseDraftAction,
  type RevisedDraftBlock,
  type RevisedDraftPoint,
} from '@/actions/analysis';
import { showToast } from '@/components/shared/toast';

/** 修订目标:块下标必填;pointIndex 为 null = 修订整块(与 core ReviseDraftTarget 对应) */
export interface ReviseTarget {
  blockIndex: number;
  pointIndex: number | null;
}

type ReviseScope = 'block' | 'point';

/** 提交修订前抓取的原文快照(预览态左栏回显) */
interface OriginSnapshot {
  title: string;
  desc: string;
  evidenceCount: number;
}

function isRevisedPoint(r: RevisedDraftPoint | RevisedDraftBlock): r is RevisedDraftPoint {
  return !('points' in r);
}

/** MM-DD HH:mm(修订记录时间展示,与原型一致) */
function formatRevisionTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 从修订后的 Run 草稿防御式提取目标块 revisions(core reviseDraft 已在库内
 * 追加本次修订摘要,本地态以库内数据为准,避免与历史链拼接错位)。
 */
function revisionsFromRun(raw: unknown, blockIndex: number): DraftRevisionView[] {
  if (!raw || typeof raw !== 'object') return [];
  const requirements = (raw as { requirements?: unknown }).requirements;
  if (!Array.isArray(requirements)) return [];
  const block = requirements[blockIndex];
  if (!block || typeof block !== 'object') return [];
  const revisions = (block as { revisions?: unknown }).revisions;
  if (!Array.isArray(revisions)) return [];
  return revisions.filter(
    (r): r is DraftRevisionView => !!r && typeof r === 'object' && typeof r.at === 'number',
  );
}

/** ✦ 四角星(提交修订时旋转,与素材面板「开始分析」一致) */
function SparkIcon({
  className = 'h-3.5 w-3.5',
  spinning = false,
}: {
  className?: string;
  spinning?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} ${spinning ? 'animate-spin' : ''}`}
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
    </svg>
  );
}

/** 快捷批注 chips(与原型四枚一致) */
const CHIP_KEYS = ['chipConcise', 'chipSplit', 'chipFormal', 'chipAcceptance'] as const;

/** spec §14:弹窗开关动画 120ms(与 shared/modal 一致) */
const ANIM_MS = 120;

/**
 * AI 修订两态弹窗(原型 P3f/P3f2,spec §9 规则 9):
 * 输入态(作用域/当前内容/修订记录/批注/快捷 chips/保留依据)→
 * 调 reviseDraftAction(LLM 重写 + 库内 revisions 追加 + 审计)→
 * 预览态(批注回显 + 原文/修订后对照)→「应用」把修订同步进工作台本地草稿
 * (由 onApplied 完整写回 Run),「放弃/取消」仅关闭、不动本地态。
 */
export function ReviseModal({
  open,
  runId,
  target,
  block,
  onClose,
  onApplied,
}: {
  open: boolean;
  runId: string | null;
  target: ReviseTarget;
  block: DraftBlockState;
  onClose: () => void;
  /** 应用:父组件更新本地块并写回 Run 草稿;返回 false 表示失败(弹窗保持打开) */
  onApplied: (blockIndex: number, nextBlock: DraftBlockState) => Promise<boolean>;
}) {
  const t = useTranslations('analysis');
  const ts = useTranslations('shared');

  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [phase, setPhase] = useState<'input' | 'preview'>('input');
  const [scope, setScope] = useState<ReviseScope>('block');
  const [annotation, setAnnotation] = useState('');
  const [keepEvidences, setKeepEvidences] = useState(true);
  const [starting, setStarting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [origin, setOrigin] = useState<OriginSnapshot | null>(null);
  const [result, setResult] = useState<RevisedDraftPoint | RevisedDraftBlock | null>(null);
  const [nextRevisions, setNextRevisions] = useState<DraftRevisionView[]>([]);

  // 打开时按入口重置全部状态;关闭播退出动画后卸载
  useEffect(() => {
    if (!open) {
      setShown(false);
      const timer = setTimeout(() => setMounted(false), ANIM_MS);
      return () => clearTimeout(timer);
    }
    setMounted(true);
    setPhase('input');
    setScope(target.pointIndex === null ? 'block' : 'point');
    setAnnotation('');
    setKeepEvidences(true);
    setStarting(false);
    setApplying(false);
    setOrigin(null);
    setResult(null);
    setNextRevisions([]);
    // 双 rAF:先绘制初始态再切目标态,过渡才生效(与 shared/modal 一致)
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // target 仅在打开瞬间读取一次,避免预览期间外部态变化打断流程
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  // 点作用域的实际下标:块级入口打开后切到「单个需求点」时,缺省落第 0 点
  const effectivePointIndex =
    scope === 'point'
      ? (target.pointIndex ?? (block.points.length > 0 ? 0 : null))
      : null;
  const currentPoint = effectivePointIndex !== null ? block.points[effectivePointIndex] : undefined;

  const curTitle = currentPoint ? currentPoint.title : block.title;
  const curDesc = currentPoint ? currentPoint.description : block.summary;
  const curEvidenceCount = currentPoint
    ? currentPoint.evidences.length
    : block.points.reduce((n, p) => n + p.evidences.length, 0);
  const curQuote = currentPoint
    ? currentPoint.evidences[0]?.quote
    : block.points.find((p) => p.evidences.length > 0)?.evidences[0]?.quote;

  const subtitle =
    scope === 'point' && currentPoint
      ? t('revise.targetPoint', { title: currentPoint.title })
      : t('revise.targetBlock', { title: block.title });

  // 修订记录:时间倒序(最新在上,与原型一致)
  const revisions = [...block.revisions].sort((a, b) => b.at - a.at);

  const startDisabled = starting || !annotation.trim() || (scope === 'point' && !currentPoint);

  async function start() {
    if (!annotation.trim() || starting) return;
    if (scope === 'point' && effectivePointIndex === null) return;
    setStarting(true);
    // 原文快照在调用前抓取(预览态左栏)
    setOrigin({
      title: curTitle,
      desc: curDesc,
      evidenceCount: curEvidenceCount,
    });
    try {
      const res = await reviseDraftAction(
        runId ?? '',
        {
          blockIndex: target.blockIndex,
          ...(effectivePointIndex !== null ? { pointIndex: effectivePointIndex } : {}),
        },
        annotation.trim(),
        keepEvidences,
      );
      if (!res.ok) {
        showToast(res.message, 'error');
        return;
      }
      setResult(res.data.revised);
      setNextRevisions(revisionsFromRun(res.data.run.draftResult, target.blockIndex));
      setPhase('preview');
    } finally {
      setStarting(false);
    }
  }

  async function apply() {
    if (applying || !result) return;
    setApplying(true);
    try {
      let nextBlock: DraftBlockState;
      if (scope === 'point' && effectivePointIndex !== null && isRevisedPoint(result)) {
        const idx = effectivePointIndex;
        nextBlock = {
          ...block,
          revisions: nextRevisions,
          points: block.points.map((p, i) =>
            i === idx
              ? {
                  ...p,
                  title: result.title,
                  description: result.description ?? '',
                  confidence: result.confidence,
                  evidences: result.evidences,
                }
              : p,
          ),
        };
      } else if (scope === 'block' && !isRevisedPoint(result)) {
        nextBlock = {
          ...block,
          title: result.title,
          summary: result.summary ?? '',
          conflict: result.conflict
            ? {
                type: result.conflict.type,
                targetTitle: result.conflict.target_requirement_title,
                reason: result.conflict.reason ?? '',
              }
            : null,
          resolution: result.conflict?.type === 'duplicate' ? 'merge' : null,
          points: result.points.map(toPointState),
          revisions: nextRevisions,
        };
      } else {
        return;
      }
      const ok = await onApplied(target.blockIndex, nextBlock);
      if (ok) return; // 父组件已 toast + 关闭
      setApplying(false);
    } catch {
      setApplying(false);
    }
  }

  const revTitle = result?.title ?? '';
  const revDesc = result ? (isRevisedPoint(result) ? (result.description ?? '') : (result.summary ?? '')) : '';
  const revEvidenceCount = result
    ? isRevisedPoint(result)
      ? result.evidences.length
      : result.points.reduce((n, p) => n + p.evidences.length, 0)
    : 0;

  return (
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
        aria-label={phase === 'input' ? t('revise.title') : t('revise.previewTitle')}
        className={`relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl transition-all duration-[120ms] ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        } ${phase === 'preview' ? 'max-w-[760px]' : 'max-w-[640px]'}`}
      >
        {/* 头部:✨ + 标题 + 对象副标题 + 关闭 */}
        <header className="flex shrink-0 items-center gap-2.5 px-5 pb-3 pt-5">
          <span className="text-lg leading-none text-accent" aria-hidden>
            ✨
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-text-primary">
              {phase === 'input' ? t('revise.title') : t('revise.previewTitle')}
            </h2>
            <p className="mt-0.5 truncate text-xs text-text-secondary">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={ts('close')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 pb-4 pt-1">
          {phase === 'input' ? (
            <>
              {/* 作用域 segmented */}
              <div className="flex rounded-lg bg-surface-2 p-[3px]" role="tablist">
                {(['block', 'point'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={scope === s}
                    disabled={starting}
                    onClick={() => setScope(s)}
                    className={`flex-1 rounded-md py-1.5 text-[13px] transition-colors duration-[120ms] disabled:opacity-60 ${
                      scope === s
                        ? 'bg-surface text-text-primary'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {s === 'block' ? t('revise.scopeBlock') : t('revise.scopePoint')}
                  </button>
                ))}
              </div>

              {/* 当前内容卡 */}
              <div className="space-y-1.5 rounded-[10px] bg-surface-2 p-3.5">
                <p className="text-[11px] text-text-muted">{t('revise.currentLabel')}</p>
                <p className="text-sm text-text-primary">{curTitle}</p>
                {curDesc && (
                  <p className="text-[12.5px] leading-relaxed text-text-secondary">{curDesc}</p>
                )}
                <p className="text-[11px] text-text-muted">
                  {t('revise.currentEvidence', { count: curEvidenceCount })}
                  {curQuote && (
                    <>
                      {' '}
                      ·「{curQuote.length > 24 ? `${curQuote.slice(0, 24)}…` : curQuote}」
                    </>
                  )}
                </p>
              </div>

              {/* 修订记录(无历史时整区隐藏) */}
              {revisions.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-text-secondary" aria-hidden>
                      🕘
                    </span>
                    <span className="text-[12.5px] text-text-primary">
                      {t('revise.historyTitle')}
                    </span>
                    <span className="rounded-full bg-accent-dim px-[7px] py-px text-[10.5px] tabular-nums text-accent">
                      {revisions.length}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {revisions.map((r, i) => (
                      <div
                        key={`${r.at}-${i}`}
                        className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-[7px] text-[11px]"
                      >
                        <span className="shrink-0 text-accent" aria-hidden>
                          ✨
                        </span>
                        <span className="shrink-0 tabular-nums text-text-muted">
                          {formatRevisionTime(r.at)}
                        </span>
                        <span
                          className={`shrink-0 truncate ${
                            r.actor.startsWith('mcp') ? 'text-ai' : 'text-text-secondary'
                          }`}
                        >
                          {r.actor}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-text-secondary">
                          「{r.annotation}」
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="rounded-md bg-accent-dim px-2.5 py-1.5 text-[10.5px] text-accent">
                    {t('revise.historyHint')}
                  </p>
                </div>
              )}

              {/* 批注输入 + 快捷 chips */}
              <label
                htmlFor="revise-annotation"
                className="block text-[12.5px] text-text-primary"
              >
                {t('revise.annotationLabel')}
              </label>
              <textarea
                id="revise-annotation"
                value={annotation}
                onChange={(e) => setAnnotation(e.target.value)}
                placeholder={t('revise.annotationPlaceholder')}
                rows={3}
                disabled={starting}
                className="h-[88px] w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-3 text-[12.5px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent disabled:opacity-60"
              />
              <div className="flex flex-wrap gap-2">
                {CHIP_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={starting}
                    onClick={() =>
                      setAnnotation((prev) => {
                        const chip = t(`revise.${k}`);
                        return prev.trim() ? `${prev.trimEnd()};${chip}` : chip;
                      })
                    }
                    className="rounded-full bg-accent-dim px-2.5 py-[5px] text-[11.5px] text-accent transition-all duration-[120ms] hover:bg-accent hover:text-white active:scale-[0.97] disabled:opacity-50"
                  >
                    {t(`revise.${k}`)}
                  </button>
                ))}
              </div>

              {/* 保留原文依据 */}
              <button
                type="button"
                role="checkbox"
                aria-checked={keepEvidences}
                disabled={starting}
                onClick={() => setKeepEvidences((v) => !v)}
                className="flex items-center gap-2 self-start text-left disabled:opacity-60"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[11px] transition-colors ${
                    keepEvidences
                      ? 'bg-accent text-white'
                      : 'border border-border bg-surface text-transparent'
                  }`}
                  aria-hidden
                >
                  ✓
                </span>
                <span className="text-xs text-text-secondary">{t('revise.keepEvidences')}</span>
              </button>
            </>
          ) : (
            <>
              {/* 批注回显条 */}
              <div className="flex items-center gap-2 rounded-lg bg-accent-dim px-3 py-2.5">
                <span className="text-[13px] text-accent" aria-hidden>
                  💬
                </span>
                <p className="min-w-0 flex-1 text-[12.5px] text-accent">
                  {t('revise.echoPrefix')}
                  {annotation.trim()}
                </p>
              </div>

              {/* 原文 / 修订后对照 */}
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="min-w-0 flex-1 space-y-2 rounded-[10px] bg-surface-2 p-3.5">
                  <p className="text-[11px] text-text-muted">{t('revise.originalLabel')}</p>
                  <p className="text-[13.5px] text-text-muted">{origin?.title}</p>
                  {origin?.desc && (
                    <p className="text-xs leading-relaxed text-text-muted">{origin.desc}</p>
                  )}
                  <p className="text-[11px] text-text-muted">
                    {t('revise.currentEvidence', { count: origin?.evidenceCount ?? 0 })}
                  </p>
                </div>
                <div className="min-w-0 flex-1 space-y-2 rounded-[10px] bg-surface-2 p-3.5 outline-2 -outline-offset-2 outline-accent">
                  <p className="text-[11px] text-accent">{t('revise.revisedLabel')}</p>
                  <p className="text-[13.5px] text-text-primary">{revTitle}</p>
                  {revDesc && (
                    <p className="text-xs leading-relaxed text-text-secondary">{revDesc}</p>
                  )}
                  {result && !isRevisedPoint(result) && (
                    <p className="text-[11px] text-text-muted">
                      {t('revise.pointsSummary', { count: result.points.length })}
                    </p>
                  )}
                  <p
                    className={`text-[11px] ${
                      keepEvidences && revEvidenceCount > 0 ? 'text-success' : 'text-text-muted'
                    }`}
                  >
                    {keepEvidences && revEvidenceCount > 0
                      ? t('revise.evidenceKept', { count: revEvidenceCount })
                      : t('revise.currentEvidence', { count: revEvidenceCount })}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex shrink-0 items-center justify-end gap-3 px-5 pb-5 pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="h-9 rounded-lg px-3 text-[13.5px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-50"
          >
            {phase === 'preview' ? t('revise.discard') : t('revise.cancel')}
          </button>
          {phase === 'input' ? (
            <button
              type="button"
              onClick={start}
              disabled={startDisabled}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-[18px] text-[13.5px] font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting ? (
                <SparkIcon spinning />
              ) : (
                <span className="text-sm leading-none" aria-hidden>
                  ✨
                </span>
              )}
              {starting ? t('revise.starting') : t('revise.start')}
            </button>
          ) : (
            <button
              type="button"
              onClick={apply}
              disabled={applying}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-[18px] text-[13.5px] font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden>✓</span>
              {applying ? t('revise.applying') : t('revise.apply')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
