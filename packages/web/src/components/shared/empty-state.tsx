'use client';

import type { ReactNode } from 'react';

/**
 * 空状态引导:插图(默认内置内联 SVG 插画,可传 illustration 覆盖)+ 标题 +
 * 描述 + 主操作按钮。计划要求:空状态必须有引导插图 + 主操作按钮(P1 等)。
 */
export function EmptyState({
  illustration,
  title,
  description,
  actionLabel,
  onAction,
}: {
  /** 自定义插图;不传时使用内置的「文档 + 添加」插画 */
  illustration?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {illustration ?? <DefaultIllustration />}
      <div>
        <p className="text-[15px] font-medium text-text-primary">{title}</p>
        {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-2 inline-flex items-center rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** 内置引导插画:两页文档 + 加号圆标,全部用 token 上色(随主题联动) */
function DefaultIllustration() {
  return (
    <svg viewBox="0 0 96 72" className="h-20 w-28" aria-hidden>
      <rect x="26" y="4" width="56" height="46" rx="6" className="fill-surface-2" />
      <rect
        x="14"
        y="16"
        width="56"
        height="46"
        rx="6"
        className="fill-surface stroke-border"
        strokeWidth="1.5"
      />
      <path
        d="M24 32h28M24 40h20"
        className="stroke-text-muted"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="62" cy="52" r="11" className="fill-accent-dim" />
      <path
        d="M62 46.5v11M56.5 52h11"
        className="stroke-accent"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
