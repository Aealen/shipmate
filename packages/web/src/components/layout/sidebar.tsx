'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { createGroupAction } from '@/actions/projects';
import { IconPlug, IconSettings } from '@/components/icons';
import { Modal } from '@/components/shared/modal';
import { showToast } from '@/components/shared/toast';
import { useSidebarMode, type SidebarMode } from './sidebar-state';

type Overview = {
  groups: Array<{ id: string; name: string; projectCount: number }>;
  grouped: Array<{ id: string; groupId: string | null }>;
  ungrouped: Array<{ id: string }>;
};

/**
 * 侧栏三态壳(expanded 240px → collapsed 64px → hidden 0 循环,240ms
 * cubic-bezier(0.2,0,0,1),spec §14)。内容对齐原型 P1 帧:「分组」小标题 +
 * 全部项目/分组行(右侧纯文字计数)+ 新建分组入口 + 底部设置/MCP;
 * 点击分组行回首页按分组过滤(/?group=)。
 */
export function Sidebar({ overview }: { overview: Overview }) {
  const { mode, cycle } = useSidebarMode();
  const t = useTranslations('nav');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentGroup = pathname === '/' ? (searchParams.get('group') ?? '') : null;

  const [groupModalOpen, setGroupModalOpen] = useState(false);

  const widths: Record<SidebarMode, string> = {
    expanded: 'w-60',
    collapsed: 'w-16',
    hidden: 'w-0',
  };

  return (
    <aside
      data-mode={mode}
      className={`group/sidebar relative flex ${widths[mode]} shrink-0 overflow-hidden border-r border-border bg-surface transition-[width] duration-[240ms] ease-[cubic-bezier(0.2,0,0,1)]`}
    >
      {/* 内容固定宽 240px,收缩时由 aside 裁切,避免文字换行 */}
      <div className="flex h-full w-60 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
          <button
            type="button"
            onClick={cycle}
            title={t('toggleSidebar')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4.5 w-4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-bold text-text-muted">{t('groups')}</p>

          <NavRow
            href="/"
            label={t('allProjects')}
            active={pathname === '/' && !currentGroup}
            showTooltip={mode === 'collapsed'}
            count={
              overview.groups.reduce((a, g) => a + g.projectCount, 0) + overview.ungrouped.length
            }
          />

          {overview.groups.map((g) => (
            <NavRow
              key={g.id}
              href={`/?group=${g.id}`}
              label={g.name}
              active={currentGroup === g.id}
              showTooltip={mode === 'collapsed'}
              count={g.projectCount}
            />
          ))}

          {overview.ungrouped.length > 0 && (
            <NavRow
              href="/?group=none"
              label={t('ungrouped')}
              active={currentGroup === 'none'}
              showTooltip={mode === 'collapsed'}
              count={overview.ungrouped.length}
            />
          )}

          <button
            type="button"
            onClick={() => setGroupModalOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-[13px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <svg
              viewBox="0 0 14 14"
              className="h-3.5 w-3.5 shrink-0"
              fill="currentColor"
              aria-hidden
            >
              <path d="M6.7 7.3H3.8a.3.3 0 0 1 0-.6h2.9V3.8a.3.3 0 0 1 .6 0v2.9h2.9a.3.3 0 0 1 0 .6H7.3v2.9a.3.3 0 0 1-.6 0V7.3Z" />
            </svg>
            <span className="min-w-0 flex-1 truncate text-left transition-opacity duration-150 group-data-[mode=collapsed]/sidebar:opacity-0">
              {t('newGroup')}
            </span>
          </button>
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

      <NewGroupModal open={groupModalOpen} onClose={() => setGroupModalOpen(false)} />
    </aside>
  );
}

/**
 * 分组导航行:文字 + 右侧纯文字计数(对齐原型:计数无底色,12px 灰)。
 * collapsed 态 300ms 延迟 tooltip。
 */
function NavRow({
  href,
  label,
  count,
  active,
  showTooltip,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
  showTooltip: boolean;
}) {
  const tip = useDelayedTooltip(showTooltip);

  return (
    <Link
      href={href}
      {...tip.handlers}
      className={`flex h-9 items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors ${
        active
          ? 'bg-accent-dim text-text-primary'
          : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
      }`}
    >
      <span className="min-w-0 flex-1 truncate transition-opacity duration-150 group-data-[mode=collapsed]/sidebar:opacity-0">
        {label}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-text-muted transition-opacity duration-150 group-data-[mode=collapsed]/sidebar:opacity-0">
        {count}
      </span>
      {tip.render(label)}
    </Link>
  );
}

/** 通用导航行:图标 + 文字(底部设置/MCP)。 */
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

/** 新建分组弹窗:名称必填,走既有 createGroupAction,成功后刷新侧栏数据 */
function NewGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('nav');
  const tHome = useTranslations('home');
  const router = useRouter();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    void createGroupAction({ name: trimmed }).then((res) => {
      setPending(false);
      if (res.ok) {
        showToast(tHome('groupCreated', { name: trimmed }));
        setName('');
        onClose();
        router.refresh();
      } else {
        showToast(res.message, 'error');
      }
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={t('newGroup')}>
      <div className="space-y-3">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder={t('groupNamePlaceholder')}
          className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            {tHome('cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || pending}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
          >
            {t('create')}
          </button>
        </div>
      </div>
    </Modal>
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
