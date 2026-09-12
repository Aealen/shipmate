'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition, type SVGProps } from 'react';

type CopyStatus = 'idle' | 'copied' | 'failed';

/** spec §14:复制成功「已复制 ✓」1.5s 后回落 */
const RESET_MS = 1500;

/**
 * 复制按钮:点击复制 → 文案切「已复制 ✓」→ 1.5s 回落(spec §14)。
 * 复制经 useTransition 触发,失败时切「复制失败」同样 1.5s 回落。
 */
export function CopyButton({ text }: { text: string }) {
  const t = useTranslations('shared');
  const [status, setStatus] = useState<CopyStatus>('idle');
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const scheduleReset = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), RESET_MS);
  };

  const handleCopy = () => {
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(text);
        setStatus('copied');
        scheduleReset();
      } catch {
        setStatus('failed');
        scheduleReset();
      }
    });
  };

  const label =
    status === 'copied' ? t('copied') : status === 'failed' ? t('copyFailed') : t('copy');

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={isPending}
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] px-2.5 text-[11px] leading-none transition-colors duration-[120ms] disabled:opacity-60 ${
        status === 'copied'
          ? 'bg-success/15 text-success'
          : status === 'failed'
            ? 'bg-danger/15 text-danger'
            : 'bg-surface-2 text-text-secondary hover:text-accent'
      }`}
    >
      <IconCopy className="h-3 w-3" />
      {label}
    </button>
  );
}

function IconCopy(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
