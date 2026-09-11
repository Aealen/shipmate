'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * P2 项目 Tab 组五项:概览/需求分析/进度/任务看板/审计,当前路由高亮。
 * 子路由(如 analysis/new)按前缀归入所属 Tab;概览仅精确匹配根路径。
 */
export function ProjectTabs({ id }: { id: string }) {
  const t = useTranslations('project');
  const pathname = usePathname();
  const base = `/project/${id}`;

  const tabs = [
    { key: 'tabOverview', href: base, active: pathname === base },
    { key: 'tabAnalysis', href: `${base}/analysis`, active: pathname.startsWith(`${base}/analysis`) },
    { key: 'tabProgress', href: `${base}/progress`, active: pathname.startsWith(`${base}/progress`) },
    { key: 'tabBoard', href: `${base}/board`, active: pathname.startsWith(`${base}/board`) },
    { key: 'tabAudit', href: `${base}/audit`, active: pathname.startsWith(`${base}/audit`) },
  ] as const;

  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label={t('tabOverview')}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className={`shrink-0 border-b-2 px-3 py-2 text-sm transition-colors duration-[120ms] ${
            tab.active
              ? 'border-accent font-medium text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
