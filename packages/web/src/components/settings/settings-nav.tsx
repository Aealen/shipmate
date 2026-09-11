'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { IconPlug, IconUser } from '@/components/icons';

/** 设置区五项(顺序即导航顺序);mcp 与侧栏入口指向同一路由 */
const ITEMS: { href: string; key: string; icon: ReactNode }[] = [
  { href: '/settings/profile', key: 'profile', icon: <IconUser className="h-4 w-4 shrink-0" /> },
  { href: '/settings/model', key: 'model', icon: <IconSliders className="h-4 w-4 shrink-0" /> },
  { href: '/settings/mcp', key: 'mcp', icon: <IconPlug className="h-4 w-4 shrink-0" /> },
  { href: '/settings/system', key: 'system', icon: <IconInfo className="h-4 w-4 shrink-0" /> },
  { href: '/settings/data', key: 'data', icon: <IconDatabase className="h-4 w-4 shrink-0" /> },
];

/** 设置区左侧二级导航:五项,当前路由高亮(样式与侧栏导航一致) */
export function SettingsNav() {
  const t = useTranslations('settings.nav');
  const pathname = usePathname();

  return (
    <nav className="flex w-44 shrink-0 flex-col gap-0.5 lg:sticky lg:top-0">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex h-9 items-center gap-2.5 rounded-md px-3 text-sm transition-colors ${
              active
                ? 'bg-accent-dim text-accent'
                : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
            }`}
          >
            {item.icon}
            <span className="min-w-0 flex-1 truncate">{t(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function IconSliders(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden
      {...props}
    >
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </svg>
  );
}

function IconInfo(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function IconDatabase(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden
      {...props}
    >
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5V12c0 1.66 3.58 3 8 3s8-1.34 8-3V5.5" />
      <path d="M4 12v6.5c0 1.66 3.58 3 8 3s8-1.34 8-3V12" />
    </svg>
  );
}
