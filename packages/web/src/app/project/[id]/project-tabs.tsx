'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { StatusBadge } from '@/components/shared/badge';
import { ProjectDeleteMenu } from '@/components/shared/delete-project-dialog';

/**
 * 项目 Tab 组(对齐原型 P2-P7 帧):五项均分整行,文字 13px 居中 +
 * 36×2px 短指示条(active accent / inactive border 色)。
 * 子路由(如 analysis/new)按前缀归入所属 Tab;概览仅精确匹配根路径。
 */
export function ProjectTabs({ id }: { id: string }) {
  const t = useTranslations('project');
  const pathname = usePathname();
  const base = `/project/${id}`;

  const tabs = [
    { key: 'tabOverview', href: base, active: pathname === base },
    {
      key: 'tabAnalysis',
      href: `${base}/analysis`,
      active: pathname.startsWith(`${base}/analysis`),
    },
    {
      key: 'tabProgress',
      href: `${base}/progress`,
      active: pathname.startsWith(`${base}/progress`),
    },
    { key: 'tabBoard', href: `${base}/board`, active: pathname.startsWith(`${base}/board`) },
    { key: 'tabAudit', href: `${base}/audit`, active: pathname.startsWith(`${base}/audit`) },
  ] as const;

  return (
    <nav className="flex w-full gap-6" aria-label={t('tabOverview')}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className="flex min-w-0 flex-1 flex-col items-center"
        >
          <span
            className={`text-[13px] leading-none transition-colors duration-[120ms] ${
              tab.active
                ? 'font-bold text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t(tab.key)}
          </span>
          <span className="h-[5px] w-8" />
          <span
            className={`h-0.5 w-9 rounded-[1px] transition-colors duration-[120ms] ${
              tab.active ? 'bg-accent' : 'bg-border'
            }`}
          />
        </Link>
      ))}
    </nav>
  );
}

/**
 * 项目上下文头部,双形态对齐原型(Notion 化):
 * - 概览路由(P2x 帧):项目名 26px bold tracking-tight + active 徽章 + 右侧
 *   MCP 提示 + 描述 13px;
 * - 其余路由(P3-P7 帧):紧凑条——项目名 17px bold tracking-tight + active
 *   徽章 + 「项目概览 ›」。
 * 两种形态下方均为均分 Tab 组;紧凑形态带底边框线。
 */
export function ProjectHeader({
  id,
  name,
  status,
  description,
}: {
  id: string;
  name: string;
  status: 'active' | 'archived';
  description: string | null;
}) {
  const t = useTranslations('project');
  const pathname = usePathname();
  const isOverview = pathname === `/project/${id}`;

  if (isOverview) {
    return (
      <div className="flex w-full flex-col gap-2.5 bg-surface px-8 pt-6">
        <div className="flex w-full items-center gap-3">
          <h1 className="min-w-0 truncate text-[26px] font-bold leading-tight tracking-tight text-text-primary">
            {name}
          </h1>
          <StatusBadge status={status} />
          <span className="min-w-0 flex-1" />
          <span className="shrink-0 text-[11px] text-text-muted">{t('mcpHint')}</span>
          {/* 头部右侧 ⋯ → 删除项目菜单(P2 入口) */}
          <ProjectDeleteMenu projectId={id} projectName={name} />
        </div>
        {description && (
          <p className="w-full text-[13px] leading-snug text-text-secondary">{description}</p>
        )}
        <div className="pt-3.5">
          <ProjectTabs id={id} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 bg-surface px-6 pt-3">
      <div className="flex w-full items-center gap-2.5">
        <h1 className="min-w-0 truncate text-[17px] font-bold leading-tight tracking-tight text-text-primary">
          {name}
        </h1>
        <StatusBadge status={status} size="sm" />
        <span className="min-w-0 flex-1" />
        <Link
          href={`/project/${id}`}
          className="shrink-0 text-xs font-bold text-accent transition-opacity duration-[120ms] hover:opacity-80"
        >
          {t('overviewLink')}
        </Link>
        <ProjectDeleteMenu projectId={id} projectName={name} />
      </div>
      <div className="pt-0.5">
        <ProjectTabs id={id} />
      </div>
      <div className="h-px w-full shrink-0 bg-border" />
    </div>
  );
}
