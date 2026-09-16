'use client';

import type { RequirementWithOverdue } from '@shipmate/core';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  getRequirementRevisionHistory,
  type RequirementRevisionHistory,
  type RevisionEntry,
} from '@/actions/revisions';

/**
 * 块级修订历史弹窗(原型 P3j):头部图标块 + 上下文行,内容区按
 * 需求块 → 各需求点 → 已移除需求点分组,组头可折叠(移除组默认收起)。
 * 数据在打开时经 server action 拉取(useTransition),关闭动画期间内容保留。
 * ClockIcon / ChevronIcon / RevisionEntryRow / formatShort 一并导出,
 * 供 P3g 点行就地下拉复用(放本文件以避免组件间循环依赖)。
 */

/** spec §14:弹窗开关动画 120ms(与 shared/modal 一致) */
const ANIM_MS = 120;

/** 时钟图标(修订历史入口统一图标,描边风格与页面内其他 svg 一致) */
export function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** 折叠指示 chevron:展开朝下、收起朝右,120ms 旋转过渡 */
export function ChevronIcon({
  className,
  expanded,
}: {
  className?: string;
  expanded: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className ?? ''} transition-transform duration-[120ms] ${
        expanded ? 'rotate-0' : '-rotate-90'
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** 日期 MM/dd(批次卡 meta 与修订条目共用) */
export function formatDate(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit' }).format(ms);
}

/** 短时间:今天 HH:mm,其余 MM/dd */
export function formatShort(ms: number, locale: string): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(ms);
  }
  return formatDate(ms, locale);
}

/**
 * 单条修订条目:左「✨ 修订」徽章 + 描述 + 右列(actor/时间)。
 * inline=点行就地下拉(白底条目、灰底徽章),modal=块弹窗(灰底条目、白底徽章);
 * 移除需求点的条目用危险色变体(底/徽章字 danger color-mix)。
 */
export function RevisionEntryRow({
  entry,
  variant,
}: {
  entry: RevisionEntry;
  variant: 'inline' | 'modal';
}) {
  const t = useTranslations('browse');
  const locale = useLocale();
  const isRemoved = entry.removedPointTitle !== undefined;
  const rowBg = isRemoved
    ? 'bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]'
    : variant === 'inline'
      ? 'bg-surface'
      : 'bg-surface-2';
  const badgeBg = isRemoved
    ? 'bg-surface text-danger'
    : variant === 'inline'
      ? 'bg-surface-2 text-accent'
      : 'bg-surface text-accent';

  return (
    <div className={`flex items-center gap-[10px] rounded-[8px] px-[10px] py-[7px] ${rowBg}`}>
      <span
        className={`inline-flex shrink-0 items-center rounded-[6px] px-[8px] py-[2px] text-[10.5px] leading-none ${badgeBg}`}
      >
        ✨ {t('revision.entryBadge')}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-secondary">
        {entry.annotation || t('revision.noAnnotation')}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-[2px] text-[10.5px] leading-none text-text-muted">
        <span>{entry.actor}</span>
        <span>{formatShort(entry.at, locale)}</span>
      </span>
    </div>
  );
}

/**
 * TAB 定义:需求块 / 各需求点 / 已移除(若有),每 TAB 只展示一个实体的修订记录。
 */
interface HistoryTab {
  key: string;
  label: string;
  entries: RevisionEntry[];
  removed?: boolean;
}

/** 头部图标块:26×26 accent-dim 底 + 时钟图标 */
function HeaderIcon() {
  return (
    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-accent-dim text-accent">
      <ClockIcon className="h-3 w-3" />
    </span>
  );
}

export function RevisionHistoryModal({
  open,
  onClose,
  requirement,
}: {
  open: boolean;
  onClose: () => void;
  /** 目标需求块;由父级在关闭动画期间保留,内容不闪空 */
  requirement: RequirementWithOverdue | null;
}) {
  const t = useTranslations('browse');
  const [history, setHistory] = useState<RequirementRevisionHistory | null>(null);
  const [pending, startTransition] = useTransition();
  // mounted 控制是否渲染(DOM 存在),shown 控制动画目标态(同 shared/modal)
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  /** 当前选中 TAB(key);历史加载后默认选第一个有修订的 TAB */
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // 打开时拉取全量修订历史;requirement.id 变化即重拉
  const requirementId = requirement?.id;
  useEffect(() => {
    if (!open || !requirementId) return;
    let alive = true;
    setHistory(null);
    startTransition(async () => {
      const data = await getRequirementRevisionHistory(requirementId);
      if (alive) setHistory(data);
    });
    return () => {
      alive = false;
    };
  }, [open, requirementId]);

  useEffect(() => {
    if (!open) {
      setShown(false);
      const timer = setTimeout(() => setMounted(false), ANIM_MS);
      return () => clearTimeout(timer);
    }
    setMounted(true);
    // 双 rAF:先让初始态(透明、上移 4px)完成一帧绘制再切目标态,过渡才生效
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

  if (!mounted || !requirement) return null;

  const pointTotal = history
    ? history.points.reduce((sum, p) => sum + p.entries.length, 0)
    : 0;
  const totalRevisions = history ? history.block.length + pointTotal : 0;
  const isEmpty = history !== null && totalRevisions === 0;

  // TAB 构建:需求块 + 各需求点 + 已移除(若有);每 TAB 只展示一个实体的修订
  const tabs: HistoryTab[] = history
    ? [
        {
          key: 'block',
          label: requirement.title,
          entries: history.block.filter((e) => e.removedPointTitle === undefined),
        },
        ...history.points.map((p) => ({
          key: p.id,
          label: p.title,
          entries: p.entries,
        })),
        ...(history.removed.length > 0
          ? [
              {
                key: 'removed',
                label: t('revision.removedBadge'),
                entries: history.removed,
                removed: true,
              },
            ]
          : []),
      ]
    : [];

  // 历史加载完成后:若当前 TAB 不存在(新弹窗/历史变化),落到第一个非空 TAB,否则第一个
  const tabsReady = history !== null && !pending;
  if (tabsReady && (activeTab === null || !tabs.some((tb) => tb.key === activeTab))) {
    const firstNonEmpty = tabs.find((tb) => tb.entries.length > 0);
    setActiveTab((firstNonEmpty ?? tabs[0])?.key ?? null);
  }
  const active = tabs.find((tb) => tb.key === activeTab) ?? null;

  let content: ReactNode = null;
  if (pending && !history) {
    content = (
      <p className="py-6 text-center text-[11px] text-text-muted">{t('revision.loading')}</p>
    );
  } else if (isEmpty) {
    content = (
      <p className="py-6 text-center text-[11px] text-text-muted">{t('revision.empty')}</p>
    );
  } else if (history && active) {
    content = (
      <>
        {/* 当前 TAB 上下文:实体名 · 条数 */}
        <p className="flex shrink-0 items-center gap-2 text-[11.5px] text-text-muted">
          <span className="min-w-0 truncate">
            {active.removed ? active.label : `${t('revision.pointBadge')} · ${active.label}`}
          </span>
          <span className="shrink-0">{t('revision.count', { count: active.entries.length })}</span>
        </p>
        {active.entries.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-text-muted">{t('revision.noEntries')}</p>
        ) : (
          <div className="flex flex-col gap-[5px]">
            {active.entries.map((entry) => (
              <RevisionEntryRow key={entry.id} entry={entry} variant="modal" />
            ))}
          </div>
        )}
      </>
    );
  }

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
        aria-label={t('revision.modalTitle')}
        className={`relative flex max-h-[80vh] w-[680px] max-w-[92vw] flex-col rounded-[12px] bg-surface p-[22px] shadow-xl transition-all duration-[120ms] ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        }`}
      >
        {/* 头部:图标块 + 标题 + 关闭圆钮 */}
        <div className="flex shrink-0 items-center gap-2.5">
          <HeaderIcon />
          <h2 className="min-w-0 truncate text-[17px] font-bold tracking-tight text-text-primary">
            {t('revision.modalTitle')}
          </h2>
          <span className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('revision.close')}
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
        {/* 上下文行:块标题 · 修订总数(需求块无版本字段,不显示虚构版本号) */}
        <p className="mt-1 shrink-0 truncate text-[11.5px] text-text-muted">
          {requirement.title} · {t('revision.contextLine', { count: totalRevisions })}
        </p>

        {/* TAB 条:需求块 / 各需求点 / 已移除;选中态 accent 下划短横 */}
        {tabs.length > 0 && !isEmpty && (
          <div
            role="tablist"
            aria-label={t('revision.modalTitle')}
            className="mt-3 flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {tabs.map((tab) => {
              const on = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setActiveTab(tab.key)}
                  className={`relative flex shrink-0 items-center gap-1 px-2.5 pb-2 pt-1.5 text-[12px] transition-colors duration-[80ms] ${
                    on
                      ? 'font-medium text-text-primary'
                      : tab.removed
                        ? 'text-danger/70 hover:text-danger'
                        : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  <span className="max-w-40 truncate">{tab.label}</span>
                  {tab.entries.length > 0 && (
                    <span className="text-[10px] tabular-nums text-text-muted">
                      {tab.entries.length}
                    </span>
                  )}
                  {on && (
                    <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 内容区:当前 TAB 的修订条目 */}
        <div className="mt-3.5 flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto">
          {content}
        </div>

        {/* 底部关闭 */}
        <div className="mt-4 flex shrink-0 justify-center">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] bg-surface-2 px-[24px] py-[9px] text-[13px] text-text-secondary transition-colors duration-[80ms] hover:text-text-primary"
          >
            {t('revision.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
