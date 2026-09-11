'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import type { getHomeOverview } from '@/actions/projects';
import { IconHome, IconPlug, IconSettings, IconShip } from '@/components/icons';
import { useSidebarMode, type SidebarMode } from './sidebar-state';

type Overview = Awaited<ReturnType<typeof getHomeOverview>>;

/**
 * 侧栏三态壳:expanded(240px)→ collapsed(64px)→ hidden(0)循环,
 * 点击左上角 ShipMate 图标切换。宽度过渡 240ms cubic-bezier(0.2,0,0,1),
 * 文字交叉淡入 150ms(spec §14);collapsed 态 hover 300ms 延迟 tooltip。
 */
export function Sidebar({ overview }: { overview: Overview }) {
  const { mode, cycle } = useSidebarMode();
  const t = useTranslations('nav');
  const pathname = usePathname();

  const widths: Record<SidebarMode, string> = {
    expanded: 'w-60',
    collapsed: 'w-16',
    hidden: 'w-0',
  };

  return (
    <aside
      data-mode={mode}
      className={`group/sidebar relative flex ${widths[mode]} shrink-0 flex-col overflow-hidden border-r border-border bg-surface transition-[width] duration-[240ms] ease-[cubic-bezier(0.2,0,0,1)]`}
    >
      {/* 内容固定宽 240px,收缩时由 aside 裁切,避免文字换行 */}
      <div className="flex h-full w-60 flex-col">
        <button
          type="button"
          onClick={cycle}
          title={t('toggleSidebar')}
          className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4 text-left hover:bg-surface-2"
        >
          <IconShip className="h-6 w-6 shrink-0 text-accent" />
          <span className="text-[15px] font-semibold tracking-wide text-text-primary transition-opacity duration-150 group-data-[mode=collapsed]/sidebar:opacity-0">
            ShipMate
          </span>
        </button>

        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          <SidebarLink
            href="/"
            label={t('home')}
            active={pathname === '/'}
            showTooltip={mode === 'collapsed'}
            icon={<IconHome className="h-4.5 w-4.5 shrink-0" />}
          />

          {overview.groups.map((g) => (
            <div key={g.id} className="pt-2">
              {mode === 'expanded' && (
                <div className="flex h-7 items-center justify-between px-3 text-xs text-text-muted">
                  <span className="truncate">{g.name}</span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 tabular-nums">
                    {g.projectCount}
                  </span>
                </div>
              )}
              {overview.grouped
                .filter((p) => p.groupId === g.id)
                .map((p) => (
                  <ProjectLink
                    key={p.id}
                    id={p.id}
                    name={p.name}
                    showTooltip={mode === 'collapsed'}
                  />
                ))}
            </div>
          ))}

          {overview.ungrouped.length > 0 && (
            <div className="pt-2">
              {mode === 'expanded' && (
                <div className="flex h-7 items-center justify-between px-3 text-xs text-text-muted">
                  <span className="truncate">{t('ungrouped')}</span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 tabular-nums">
                    {overview.ungrouped.length}
                  </span>
                </div>
              )}
              {overview.ungrouped.map((p) => (
                <ProjectLink
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  showTooltip={mode === 'collapsed'}
                />
              ))}
            </div>
          )}
        </nav>

        <div className="shrink-0 space-y-0.5 border-t border-border p-2">
          <SidebarLink
            href="/settings/profile"
            label={t('settings')}
            active={pathname.startsWith('/settings') && pathname !== '/settings/mcp'}
            showTooltip={mode === 'collapsed'}
            icon={<IconSettings className="h-4.5 w-4.5 shrink-0" />}
          />
          <SidebarLink
            href="/settings/mcp"
            label={t('mcp')}
            active={pathname === '/settings/mcp'}
            showTooltip={mode === 'collapsed'}
            icon={<IconPlug className="h-4.5 w-4.5 shrink-0" />}
          />
        </div>
      </div>
    </aside>
  );
}

/**
 * 通用导航行:图标 + 文字。
 * collapsed 态 300ms 延迟 tooltip(fixed 定位,不受 aside overflow 裁切)。
 */
function SidebarLink({
  href,
  label,
  active,
  icon,
  showTooltip,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: ReactNode;
  showTooltip: boolean;
}) {
  const tip = useDelayedTooltip(showTooltip);

  return (
    <Link
      href={href}
      {...tip.handlers}
      className={`flex h-9 items-center gap-2.5 rounded-md px-3 text-sm transition-colors ${
        active
          ? 'bg-accent-dim text-accent'
          : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate transition-opacity duration-150 group-data-[mode=collapsed]/sidebar:opacity-0">
        {label}
      </span>
      {tip.render(label)}
    </Link>
  );
}

/** 项目行:图标位显示项目名首字符;tooltip 为全名;href 走 /project/[id] */
function ProjectLink({
  id,
  name,
  showTooltip,
}: {
  id: string;
  name: string;
  showTooltip: boolean;
}) {
  const tip = useDelayedTooltip(showTooltip);

  return (
    <Link
      href={`/project/${id}`}
      {...tip.handlers}
      className="flex h-9 items-center gap-2.5 rounded-md px-3 text-sm text-text-secondary hover:bg-surface-2 hover:text-text-primary"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent-dim text-[11px] text-accent">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate transition-opacity duration-150 group-data-[mode=collapsed]/sidebar:opacity-0">
        {name}
      </span>
      {tip.render(name)}
    </Link>
  );
}

/** hover 300ms 后显示 fixed tooltip(mouse enter/leave 管理) */
function useDelayedTooltip(enabled: boolean) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPos(null);
  };

  const handlers = enabled
    ? {
        onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
          const r = e.currentTarget.getBoundingClientRect();
          timer.current = setTimeout(
            () => setPos({ x: r.right + 8, y: r.top + r.height / 2 }),
            300,
          );
        },
        onMouseLeave: clear,
      }
    : {};

  return {
    handlers,
    render: (label: string) =>
      pos ? (
        <span
          style={{ left: pos.x, top: pos.y }}
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-primary shadow-sm"
        >
          {label}
        </span>
      ) : null,
  };
}
