'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { getProject, deleteProjectAction } from '@/actions/projects';
import { listAnalysisRuns } from '@/actions/analysis';
import { listTasks } from '@/actions/tasks';
import { showToast } from '@/components/shared/toast';

/** 弹窗警示条的五项级联统计(对齐原型 P2c 统计行) */
interface CascadeStats {
  requirements: number;
  points: number;
  tasks: number;
  runs: number;
  materials: number;
}

const ANIM_MS = 120;

/**
 * 删除项目确认弹窗(P2c 加强帧,Notion 化标题层级):红系头部(🗑/标题 17px
 * bold tracking-tight/副题)→ 红色警示条(项目名 + 五项统计红色大数字)→
 * 蓝色审计保障条 → 「输入项目名称以确认」精确匹配解锁删除按钮 →
 * 取消 / 🗑 永久删除。打开时才并行取数(getProject / listTasks / listAnalysisRuns)。
 */
export function DeleteProjectDialog({
  projectId,
  projectName,
  open,
  onClose,
}: {
  projectId: string;
  projectName: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('deleteProject');
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [stats, setStats] = useState<CascadeStats | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  // 开弹窗:复位输入并取统计(需求/需求点来自概要,任务/批次/素材来自各自 action)
  useEffect(() => {
    if (!open) {
      setShown(false);
      const timer = setTimeout(() => setMounted(false), ANIM_MS);
      return () => clearTimeout(timer);
    }
    setMounted(true);
    setConfirmText('');
    setStats(null);
    setStatsFailed(false);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true));
    });
    void (async () => {
      try {
        const [summary, tasks, runs] = await Promise.all([
          getProject(projectId),
          listTasks({ projectId }),
          listAnalysisRuns(projectId),
        ]);
        setStats({
          requirements: summary.requirementTotal,
          points: Object.values(summary.pointStatusCounts).reduce((a, b) => a + b, 0),
          tasks: tasks.length,
          runs: runs.length,
          materials: runs.reduce((a, r) => a + r.materialCount, 0),
        });
      } catch {
        setStatsFailed(true);
      }
    })();
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const canDelete = confirmText.trim() === projectName && projectName.length > 0;

  const submit = () => {
    if (!canDelete || pending) return;
    startTransition(async () => {
      const res = await deleteProjectAction(projectId);
      if (res.ok) {
        showToast(t('deleted', { name: projectName }));
        // 删除后当前项目页已不存在,回首页(数据已经 revalidateApp)
        router.push('/');
      } else {
        showToast(res.message, 'error');
      }
    });
  };

  if (!mounted) return null;

  const statCells: Array<{ label: string; value: number | null }> = [
    { label: t('statRequirements'), value: stats?.requirements ?? null },
    { label: t('statPoints'), value: stats?.points ?? null },
    { label: t('statTasks'), value: stats?.tasks ?? null },
    { label: t('statRuns'), value: stats?.runs ?? null },
    { label: t('statMaterials'), value: stats?.materials ?? null },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[18vh]">
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
        className={`relative flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[14px] bg-surface shadow-xl transition-all duration-[120ms] ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        }`}
      >
        {/* 红系头部:危险图标 + 标题/副题 */}
        <div className="flex shrink-0 items-center gap-2.5 px-5 pb-3.5 pt-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-danger/10 text-[17px]">
            🗑
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[17px] font-bold leading-tight tracking-tight text-danger">
              {t('title')}
            </span>
            <span className="text-xs leading-tight text-text-secondary">{t('subtitle')}</span>
          </span>
        </div>

        <div className="flex shrink-0 flex-col gap-3.5 px-5 pb-4">
          {/* 红色警示条:项目名 + 五项统计 */}
          <div className="rounded-[10px] bg-danger/[0.08] p-3 pt-3 outline outline-1 -outline-offset-1 outline-danger/30">
            <p className="text-[13px] leading-snug text-danger">
              {t('warning', { name: projectName })}
            </p>
            <div className="flex w-full flex-wrap items-start gap-x-4 gap-y-2 pt-1">
              {statCells.map((cell) => (
                <span key={cell.label} className="flex flex-col items-center gap-0.5">
                  <span className="text-[17px] font-bold leading-tight text-danger">
                    {cell.value ?? '—'}
                  </span>
                  <span className="text-[10.5px] leading-none text-text-secondary">
                    {cell.label}
                  </span>
                </span>
              ))}
              {statsFailed && (
                <span className="pt-1 text-[11px] text-text-muted">{t('statsFailed')}</span>
              )}
            </div>
          </div>

          {/* 审计保障条(蓝) */}
          <div className="flex items-center gap-2 rounded-lg bg-accent-dim px-3 py-2">
            <span className="shrink-0 text-xs text-accent">🛡</span>
            <span className="text-[11.5px] leading-snug text-accent">{t('auditNote')}</span>
          </div>

          {/* 确认输入:精确匹配项目名才解锁 */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-text-primary">
              {t('confirmLabel', { name: projectName })}
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={t('confirmPlaceholder', { name: projectName })}
              maxLength={200}
              autoFocus
              className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-danger"
            />
          </label>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 px-5 pb-5 pt-0.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1.5 text-[13.5px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canDelete || pending}
            className="flex items-center gap-1.5 rounded-lg bg-danger px-[18px] py-[9px] text-[13.5px] text-white transition-opacity duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {pending ? t('submitting') : t('submit')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * 项目删除入口(⋯ 触发按钮 + 下拉菜单 + 确认弹窗),P1 卡片与 P2 头部共用。
 * P1 卡片整体是 <Link>,触发器用 span[role=button] 避免交互元素嵌套 <a> 的
 * DOM 警告,并 stopPropagation/preventDefault 防误触卡片跳转;
 * autoHide=true 时配合父级 group 在 hover 时才显示(P1 卡片右上)。
 */
export function ProjectDeleteMenu({
  projectId,
  projectName,
  autoHide = false,
  className = '',
}: {
  projectId: string;
  projectName: string;
  /** 配合父级 group 类:hover 才显示触发按钮(P1 卡片) */
  autoHide?: boolean;
  className?: string;
}) {
  const t = useTranslations('deleteProject');
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, closeMenu]);

  // 弹窗打开时收起菜单,避免弹窗后面残留下拉层
  useEffect(() => {
    if (dialogOpen) closeMenu();
  }, [dialogOpen, closeMenu]);

  return (
    <span ref={rootRef} className={`relative inline-flex shrink-0 ${className}`}>
      <span
        role="button"
        tabIndex={0}
        aria-label={t('menu')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }
        }}
        className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-base leading-none text-text-muted transition-all duration-[120ms] hover:bg-surface-2 hover:text-text-primary focus-visible:opacity-100 ${
          autoHide ? 'opacity-0 group-hover:opacity-100' : ''
        } ${menuOpen ? 'bg-surface-2 text-text-primary opacity-100' : ''}`}
      >
        ⋯
      </span>
      {menuOpen && (
        <span
          role="menu"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="dropdown-enter absolute right-0 top-[calc(100%+4px)] z-10 flex w-36 flex-col overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          <span
            role="menuitem"
            tabIndex={0}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDialogOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                setDialogOpen(true);
              }
            }}
            className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-[13px] text-danger transition-colors hover:bg-danger/10"
          >
            🗑 {t('menu')}
          </span>
        </span>
      )}
      <DeleteProjectDialog
        projectId={projectId}
        projectName={projectName}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </span>
  );
}
