'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * 侧栏三态(expanded 240px → collapsed 64px → hidden 0)循环切换的状态源。
 * 形态经 localStorage 持久化(spec §14:按页面记忆);SSR 与客户端首帧
 * 统一渲染 expanded,挂载后同步持久化值(可能有单帧差异,本地工具可接受)。
 */
export type SidebarMode = 'expanded' | 'collapsed' | 'hidden';

const STORAGE_KEY = 'shipmate.sidebar.mode';

const NEXT_MODE: Record<SidebarMode, SidebarMode> = {
  expanded: 'collapsed',
  collapsed: 'hidden',
  hidden: 'expanded',
};

type SidebarModeContextValue = {
  mode: SidebarMode;
  cycle: () => void;
  setMode: (mode: SidebarMode) => void;
};

const SidebarModeContext = createContext<SidebarModeContextValue | null>(null);

export function SidebarModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<SidebarMode>('expanded');

  // 挂载后同步 localStorage 持久化形态
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'expanded' || saved === 'collapsed' || saved === 'hidden') {
        setModeState(saved);
      }
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }, []);

  const setMode = useCallback((next: SidebarMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const cycle = useCallback(() => {
    setMode(NEXT_MODE[mode]);
  }, [mode, setMode]);

  return (
    <SidebarModeContext.Provider value={{ mode, cycle, setMode }}>
      {children}
    </SidebarModeContext.Provider>
  );
}

export function useSidebarMode(): SidebarModeContextValue {
  const ctx = useContext(SidebarModeContext);
  if (!ctx) {
    throw new Error('useSidebarMode 必须在 SidebarModeProvider 内使用');
  }
  return ctx;
}
