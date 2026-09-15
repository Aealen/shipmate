'use client';

import type { ModuleSummary } from '@shipmate/core';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createModuleAction,
  deleteModuleAction,
  updateModuleAction,
} from '@/actions/modules';
import { showToast } from '@/components/shared/toast';

/**
 * 模块管理共用弹窗(P2 模块进度区块与 P3 需求分析页共用):
 * 模块新建/重命名表单(ModuleFormModal)与删除确认(ModuleDeleteDialog)。
 * 从 analysis-browse 抽出,行为保持不变;i18n 统一走 browse.modules 命名空间。
 */

/** spec §14:弹窗开关动画 120ms(与 shared/modal 一致) */
const ANIM_MS = 120;

/** box 图标(自绘 12px 立方体,随 currentColor 着色):模块组头/模块卡与模块弹窗共用 */
export function BoxIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </svg>
  );
}

/** 文件内轻量弹窗壳:与 RequirementEditModal 同族(portal + 120ms 开关动画 + Escape/遮罩关闭) */
function ModalShell({
  open,
  onClose,
  label,
  width,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  /** 弹窗宽度类,如 max-w-[440px] */
  width: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  // 开关动画时序与 RequirementEditModal 一致:mounted 控制渲染,双 rAF 保证过渡生效
  useEffect(() => {
    if (!open) {
      setShown(false);
      const timer = setTimeout(() => setMounted(false), ANIM_MS);
      return () => clearTimeout(timer);
    }
    setMounted(true);
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
        aria-label={label}
        className={`relative flex max-h-[85vh] w-full ${width} flex-col rounded-[12px] bg-surface p-[22px] shadow-xl transition-all duration-[120ms] ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        }`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 模块新建 / 重命名弹窗(轻量:名称必填 + 新建时描述可选;重命名只改名单)。
 * MODULE_NAME_TAKEN 在表单内联展示「模块名已存在」,其余错误走 toast。
 */
export function ModuleFormModal({
  projectId,
  mode,
  module,
  open,
  onClose,
  onSaved,
}: {
  projectId: string;
  mode: 'create' | 'rename';
  module: ModuleSummary | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tm = useTranslations('browse.modules');
  const ts = useTranslations('shared');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 每次打开重置(组件因「数据与开关分离」不随关闭卸载,与 RequirementEditModal 同理)
  useEffect(() => {
    if (open) {
      setName(mode === 'rename' ? (module?.name ?? '') : '');
      setDescription('');
      setError(null);
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 名称必填非空,空值禁用提交
  const canSubmit = name.trim().length > 0 && !saving;
  const title = tm(mode === 'create' ? 'createTitle' : 'renameTitle');

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const res =
      mode === 'create'
        ? await createModuleAction({
            projectId,
            name: name.trim(),
            description: description.trim() || undefined,
          })
        : await updateModuleAction(module!.id, { name: name.trim() });
    setSaving(false);
    if (res.ok) {
      showToast(mode === 'create' ? tm('created') : tm('renamed'), 'success');
      onSaved();
    } else if (res.code === 'MODULE_NAME_TAKEN') {
      setError(tm('exists'));
    } else {
      showToast(res.message, 'error');
    }
  };

  return (
    <ModalShell open={open} onClose={onClose} label={title} width="max-w-[440px]">
      {/* 头部:box 图标块 + 标题 + 圆形关闭钮 */}
      <div className="flex shrink-0 items-center gap-2.5">
        <span
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-accent-dim text-accent"
          aria-hidden
        >
          <BoxIcon />
        </span>
        <h2 className="min-w-0 flex-1 text-[17px] font-bold tracking-tight text-text-primary">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={ts('close')}
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] text-text-secondary transition-colors duration-[120ms] hover:text-text-primary"
        >
          ✕
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pt-3.5">
        {/* 名称(必填) */}
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-text-muted">{tm('groupName')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder={tm('groupNamePh')}
            autoFocus
            className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors duration-[120ms] placeholder:text-text-muted focus:border-accent"
          />
        </label>

        {/* 描述(仅新建提供,可选) */}
        {mode === 'create' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-text-muted">{tm('groupDesc')}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={tm('groupDescPh')}
              className="w-full resize-none rounded-lg border border-border bg-bg px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors duration-[120ms] placeholder:text-text-muted focus:border-accent"
            />
          </label>
        )}

        {/* 重名内联错误(MODULE_NAME_TAKEN) */}
        {error && <p className="text-[11.5px] text-danger">{error}</p>}
      </div>

      {/* 底部操作:右对齐 取消 / 提交 */}
      <div className="flex shrink-0 items-center justify-end gap-2.5 pt-3.5">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-lg bg-surface-2 px-4 py-[9px] text-[13px] text-text-secondary transition-colors duration-[120ms] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {tm('cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-full bg-accent px-4 py-[9px] text-[13px] font-bold text-white transition-opacity duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? tm(mode === 'create' ? 'creating' : 'saving') : tm(mode === 'create' ? 'create' : 'save')}
        </button>
      </div>
    </ModalShell>
  );
}

/**
 * 模块删除确认弹窗(delete-project-dialog 的危险确认简化版):
 * 红系头部 + 警示条(模块名 + N 个需求转未归类)+ 取消 / 删除;不做输入确认。
 */
export function ModuleDeleteDialog({
  module,
  open,
  onClose,
  onSaved,
}: {
  module: ModuleSummary;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tm = useTranslations('browse.modules');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) setPending(false);
  }, [open]);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    const res = await deleteModuleAction(module.id);
    setPending(false);
    if (res.ok) {
      showToast(tm('deleted', { name: module.name, count: module.requirementCount }), 'success');
      onSaved();
    } else {
      showToast(res.message, 'error');
    }
  };

  return (
    <ModalShell open={open} onClose={onClose} label={tm('deleteTitle')} width="max-w-[440px]">
      {/* 红系头部:危险图标 + 标题/模块名 */}
      <div className="flex shrink-0 items-center gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-danger/10 text-[17px]"
          aria-hidden
        >
          🗑
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[17px] font-semibold leading-tight tracking-tight text-danger">
            {tm('deleteTitle')}
          </span>
          <span className="truncate text-xs leading-tight text-text-secondary">{module.name}</span>
        </span>
      </div>

      {/* 红色警示条:模块下 N 个需求将转为未归类 */}
      <div className="mt-3.5 shrink-0 rounded-[10px] bg-danger/[0.08] p-3 outline outline-1 -outline-offset-1 outline-danger/30">
        <p className="text-[13px] leading-snug text-danger">
          {tm('deleteConfirm', { name: module.name, count: module.requirementCount })}
        </p>
      </div>

      {/* 底部操作:右对齐 取消 / 删除 */}
      <div className="flex shrink-0 items-center justify-end gap-2.5 pt-4">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="rounded-lg bg-surface-2 px-4 py-[9px] text-[13px] text-text-secondary transition-colors duration-[120ms] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {tm('cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-danger px-4 py-[9px] text-[13px] font-bold text-white transition-opacity duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? tm('deleting') : tm('deleteModule')}
        </button>
      </div>
    </ModalShell>
  );
}
