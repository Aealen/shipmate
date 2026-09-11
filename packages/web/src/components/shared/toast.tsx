'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

export type ToastType = 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

/** spec §14:toast 3s 自动消失 */
const TOAST_DURATION_MS = 3000;

const listeners = new Set<(item: ToastItem) => void>();
let seq = 0;

/**
 * 全局 toast 入口:任意事件回调(server action 返回后)可直接调用,
 * 由挂在 layout 的 <ToastHost /> 订阅渲染。message 由调用方传入
 * (DomainError.message 中文原文或翻译键取值)。
 */
export function showToast(message: string, type: ToastType = 'success') {
  const item: ToastItem = { id: ++seq, message, type };
  listeners.forEach((notify) => notify(item));
}

/** toast 宿主:挂在根 layout,顶部居中堆叠展示,3s 自动消失 */
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const notify = (item: ToastItem) => {
      setItems((prev) => [...prev.slice(-4), item]);
    };
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2">
      {items.map((item) => (
        <Toast key={item.id} item={item} onDismiss={dismiss} />
      ))}
    </div>
  );
}

/** 单条 toast:挂载后顶部滑入(下移复位 + 淡入),到期或点击关闭后移除 */
function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const t = useTranslations('shared');
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // 双 rAF 确保初始态(上移、透明)先绘制一帧,滑入过渡才生效
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true));
    });
    const timer = setTimeout(() => onDismiss(item.id), TOAST_DURATION_MS);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
  }, [item.id, onDismiss]);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex w-full items-start gap-2 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm shadow-lg transition-all duration-[180ms] ${
        shown ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
      }`}
    >
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
          item.type === 'success' ? 'bg-success' : 'bg-danger'
        }`}
      />
      <span className="min-w-0 flex-1 break-words text-text-primary">{item.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label={t('close')}
        className="shrink-0 text-text-muted transition-colors hover:text-text-primary"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
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
  );
}
