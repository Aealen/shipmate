'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  IconGlobe,
  IconLogOut,
  IconMoon,
  IconPanelLeft,
  IconPlug,
  IconSettings,
  IconSun,
  IconUser,
} from '@/components/icons';
import { setUserLocale } from '@/i18n/locale';
import { useSidebarMode } from './sidebar-state';

/**
 * 顶栏:常态仅右侧头像;点开下拉(120ms 淡入 + 4px 下移复位):
 * 用户信息、深色模式开关、中/EN 切换、设置、MCP 接入、退出登录(占位)。
 * 侧栏 hidden 态时左侧出现展开按钮。
 */
export function Topbar() {
  const t = useTranslations('topbar');
  const { mode, setMode } = useSidebarMode();

  return (
    <header className="relative z-40 flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-3">
      {mode === 'hidden' ? (
        <button
          type="button"
          onClick={() => setMode('expanded')}
          title={t('expandSidebar')}
          className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-2 hover:text-text-primary"
        >
          <IconPanelLeft className="h-4.5 w-4.5" />
        </button>
      ) : (
        <span />
      )}

      <AvatarMenu />
    </header>
  );
}

function AvatarMenu() {
  const t = useTranslations('topbar');
  const locale = useLocale();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // next-themes 的 resolvedTheme 需挂载后可得,避免水合不一致
  useEffect(() => setMounted(true), []);

  // 点击下拉外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const isDark = mounted && resolvedTheme === 'dark';

  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');

  const switchLocale = async () => {
    await setUserLocale(locale === 'zh-CN' ? 'en' : 'zh-CN');
    router.refresh();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white transition-transform hover:opacity-90 active:scale-95"
      >
        M
      </button>

      {open && (
        <div
          role="menu"
          className="dropdown-enter absolute right-0 top-[calc(100%+8px)] w-52 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          {/* 用户信息 */}
          <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
              <IconUser className="h-4.5 w-4.5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm text-text-primary">{t('userName')}</span>
              <span className="block truncate text-xs text-text-muted">{t('userEmail')}</span>
            </span>
          </div>

          <MenuItem
            icon={isDark ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
            label={isDark ? t('lightMode') : t('darkMode')}
            onClick={() => {
              toggleTheme();
              setOpen(false);
            }}
          />
          <MenuItem
            icon={<IconGlobe className="h-4 w-4" />}
            label={locale === 'zh-CN' ? t('switchToEn') : t('switchToZh')}
            onClick={() => {
              void switchLocale();
              setOpen(false);
            }}
          />
          <MenuLink
            href="/settings/profile"
            icon={<IconSettings className="h-4 w-4" />}
            label={t('settings')}
            onNavigate={() => setOpen(false)}
          />
          <MenuLink
            href="/settings/mcp"
            icon={<IconPlug className="h-4 w-4" />}
            label={t('mcp')}
            onNavigate={() => setOpen(false)}
          />
          <div className="border-t border-border" />
          <MenuItem
            icon={<IconLogOut className="h-4 w-4" />}
            label={t('logout')}
            disabled
            onClick={() => {}}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary ${
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-surface-2 hover:text-text-primary'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function MenuLink({
  href,
  icon,
  label,
  onNavigate,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      role="menuitem"
      href={href}
      onClick={onNavigate}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-2 hover:text-text-primary"
    >
      {icon}
      {label}
    </Link>
  );
}
