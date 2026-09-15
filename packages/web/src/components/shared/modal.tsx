'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** spec §14:弹窗开关动画 120ms(Tailwind 类里的 duration-[120ms] 与此对应) */
const ANIM_MS = 120;

/**
 * 通用弹窗:遮罩 + 居中卡片 + 右上关闭钮。
 * portal 挂 body;开关动画 120ms 淡入 + 4px 下移复位(spec §14);
 * 点击遮罩或 Esc 关闭。open 受控,关闭先播退出动画再卸载。
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const t = useTranslations('shared');
  // mounted 控制是否渲染(DOM 存在),shown 控制动画目标态
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) {
      setShown(false);
      const timer = setTimeout(() => setMounted(false), ANIM_MS);
      return () => clearTimeout(timer);
    }
    setMounted(true);
    // 双 rAF:先让初始态(透明、上移 4px)完成一帧绘制再切目标态,过渡才生效
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-[120ms] ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-[14px] bg-surface shadow-xl transition-all duration-[120ms] ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-bold tracking-tight text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
