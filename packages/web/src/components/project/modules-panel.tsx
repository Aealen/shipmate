'use client';

import type { ModuleSummary } from '@shipmate/core';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { BoxIcon, ModuleDeleteDialog, ModuleFormModal } from '@/components/modules/module-dialogs';

export interface ModulesPanelProps {
  projectId: string;
  /** 模块列表(listModulesAction,组序已按 sortOrder→name,附需求/点就绪统计) */
  modules: ModuleSummary[];
}

/**
 * P2 项目概览「模块进度」区块(对齐原型 P2 帧 Module Progress):
 * 区块头(box 图标 + 标题 + 副题 + 新建入口)+ 3 列模块卡(头行就绪比 +
 * 进度条 + 底行统计/查看需求)。模块是项目级概念,新建/重命名/删除在此自管
 * (复用 module-dialogs 两组件,与 P3 需求分析页共用),成功后 router.refresh()。
 * 无模块时保留区块头与新建入口,网格区显示引导文案(spec §14 空态策略)。
 */
export function ModulesPanel({ projectId, modules }: ModulesPanelProps) {
  const tm = useTranslations('browse.modules');
  const router = useRouter();

  // 弹窗数据与开关分离(与 analysis-browse 同模式):关闭只切 open,动画期间内容不闪空
  const [moduleForm, setModuleForm] = useState<{
    mode: 'create' | 'rename';
    module: ModuleSummary | null;
  } | null>(null);
  const [moduleFormOpen, setModuleFormOpen] = useState(false);
  const [moduleDelete, setModuleDelete] = useState<ModuleSummary | null>(null);
  const [moduleDeleteOpen, setModuleDeleteOpen] = useState(false);

  const openModuleCreate = () => {
    setModuleForm({ mode: 'create', module: null });
    setModuleFormOpen(true);
  };

  const openModuleRename = (m: ModuleSummary) => {
    setModuleForm({ mode: 'rename', module: m });
    setModuleFormOpen(true);
  };

  const openModuleDelete = (m: ModuleSummary) => {
    setModuleDelete(m);
    setModuleDeleteOpen(true);
  };

  return (
    <section className="flex w-full flex-col gap-3.5">
      {/* 区块头:图标块 + 标题 + 副题 + 「+ 新建模块」幽灵按钮 */}
      <div className="flex w-full items-center gap-2.5">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-accent-dim text-accent"
          aria-hidden
        >
          <BoxIcon />
        </span>
        <h2 className="text-[15px] font-bold tracking-tight text-text-primary">
          {tm('overviewTitle')}
        </h2>
        <span className="truncate text-[11px] text-text-muted">{tm('overviewSubtitle')}</span>
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={openModuleCreate}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-text-secondary transition-colors duration-[120ms] hover:border-accent hover:text-accent"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          {tm('createModule')}
        </button>
      </div>

      {modules.length === 0 ? (
        /* 无模块引导:保留区块头与新建入口,网格区一行 muted 文案 */
        <p className="py-6 text-center text-[12px] text-text-muted">{tm('emptyHint')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {modules.map((m) => (
            <ModuleCard
              key={m.id}
              module={m}
              analysisHref={`/project/${projectId}/analysis`}
              onRename={openModuleRename}
              onDelete={openModuleDelete}
            />
          ))}
        </div>
      )}

      {/* P3k 共用弹窗:新建/重命名表单(挂载后 moduleForm 非空;成功后刷新服务端数据) */}
      {moduleForm && (
        <ModuleFormModal
          projectId={projectId}
          mode={moduleForm.mode}
          module={moduleForm.module}
          open={moduleFormOpen}
          onClose={() => setModuleFormOpen(false)}
          onSaved={() => {
            setModuleFormOpen(false);
            router.refresh();
          }}
        />
      )}

      {/* P3k 共用弹窗:删除确认 */}
      {moduleDelete && (
        <ModuleDeleteDialog
          module={moduleDelete}
          open={moduleDeleteOpen}
          onClose={() => setModuleDeleteOpen(false)}
          onSaved={() => {
            setModuleDeleteOpen(false);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

/** 模块卡(原型:白卡):头行 图标+名称+就绪比+⋯菜单(hover 显隐),进度条,底行统计+查看需求 */
function ModuleCard({
  module,
  analysisHref,
  onRename,
  onDelete,
}: {
  module: ModuleSummary;
  analysisHref: string;
  onRename: (module: ModuleSummary) => void;
  onDelete: (module: ModuleSummary) => void;
}) {
  const tm = useTranslations('browse.modules');
  // 点就绪百分比:无需求点时进度条为空(0 宽 fill)
  const pct =
    module.pointsTotal > 0 ? Math.round((module.pointsDone / module.pointsTotal) * 100) : 0;

  return (
    <div className="group flex flex-col gap-3 rounded-[14px] bg-surface p-[18px] transition-shadow duration-[120ms] hover:shadow-sm">
      {/* 头行:图标 + 模块名 + 就绪比 + ⋯ 菜单 */}
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-accent-dim text-accent"
          aria-hidden
        >
          <BoxIcon />
        </span>
        <span className="min-w-0 truncate text-[14px] font-bold tracking-tight text-text-primary">
          {module.name}
        </span>
        <span className="min-w-0 flex-1" />
        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
          {module.pointsDone}/{module.pointsTotal}
        </span>
        <ModuleCardMenu module={module} onRename={onRename} onDelete={onDelete} />
      </div>

      {/* 进度条:点就绪占比 */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width] duration-[180ms]" style={{ width: `${pct}%` }} />
      </div>

      {/* 底行:需求统计 + 查看需求入口 */}
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-[11px] text-text-muted">
          {tm('count', {
            count: module.requirementCount,
            done: module.pointsDone,
            total: module.pointsTotal,
          })}
        </span>
        <span className="min-w-0 flex-1" />
        <Link
          href={analysisHref}
          className="shrink-0 text-[11px] font-bold text-accent transition-opacity duration-[120ms] hover:opacity-80"
        >
          {tm('viewReqs')} ›
        </Link>
      </div>
    </div>
  );
}

/**
 * 模块卡 ⋯ 菜单(重命名 / 删除):与 P3 ModuleMenu 同模式(点外与 Escape 关闭,
 * 选中项只回调,弹窗开关由父级管理);卡片 hover 时显隐,菜单展开期保持可见。
 */
function ModuleCardMenu({
  module,
  onRename,
  onDelete,
}: {
  module: ModuleSummary;
  onRename: (module: ModuleSummary) => void;
  onDelete: (module: ModuleSummary) => void;
}) {
  const tm = useTranslations('browse.modules');
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex shrink-0 ${
        menuOpen ? '' : 'opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100'
      }`}
    >
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={tm('menu')}
        className={`flex h-5 w-5 items-center justify-center rounded text-[13px] leading-none text-text-muted transition-colors duration-[120ms] hover:bg-surface-2 hover:text-text-primary ${
          menuOpen ? 'bg-surface-2 text-text-primary' : ''
        }`}
      >
        ⋯
      </button>
      {menuOpen && (
        <span
          role="menu"
          className="dropdown-enter absolute right-0 top-[calc(100%+4px)] z-10 flex w-36 flex-col overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onRename(module);
            }}
            className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-2"
          >
            ✏ {tm('renameModule')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onDelete(module);
            }}
            className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-left text-[13px] text-danger transition-colors hover:bg-danger/10"
          >
            🗑 {tm('deleteModule')}
          </button>
        </span>
      )}
    </span>
  );
}
