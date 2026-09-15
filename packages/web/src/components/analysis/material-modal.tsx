'use client';

import type { MaterialRow } from '@shipmate/core';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 素材详情 Modal(原型 P3m 查看 / P3m2 编辑双态):
 * 查看态 = 类型徽章 + 标题 + 编辑/关闭 + 元信息(类型 · 字数 · 录入时间)+ 全文;
 * 编辑态 = 提示行 + 标题/原文表单 + 取消/保存。
 * 入口:左栏素材卡/✏ 直达编辑、需求块与需求点来源素材名(经 workbench 按名反查)。
 * 数据由父级持有(material 行),关闭动画期间保留上次内容不闪空。
 */

/** spec §14:弹窗开关动画 120ms(与 shared/modal 一致) */
const ANIM_MS = 120;

/** 短时间:MM/dd HH:mm(元信息行) */
function formatAdded(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ms);
}

export function MaterialModal({
  material,
  startInEdit = false,
  onClose,
  onUpdate,
}: {
  /** 当前查看的素材;null = 无(仅关闭动画期间短暂出现,展示保留内容) */
  material: MaterialRow | null;
  /** 打开时直达编辑态(素材卡 ✏ 入口) */
  startInEdit?: boolean;
  onClose: () => void;
  /** 保存(workbench 的 handleUpdateMaterial:action + toast + 列表替换);true = 成功 */
  onUpdate: (id: string, input: { title: string; rawContent: string }) => Promise<boolean>;
}) {
  const t = useTranslations('analysis');
  const locale = useLocale();

  // mounted 控制渲染,shown 控制动画目标态;关闭动画期间保留 material 展示
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [editing, setEditing] = useState(startInEdit);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  // 打开(或切换到另一条素材)时重置;同 id 行内更新(保存后回写)不重置,
  // 保持 save() 设置的查看态并展示新值
  const materialId = material?.id;
  useEffect(() => {
    if (material) {
      setEditing(startInEdit);
      if (startInEdit) {
        setTitle(material.title ?? '');
        setContent(material.rawContent);
      }
      setMounted(true);
    }
    // startInEdit 不入依赖:仅在素材切换时生效
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId]);

  useEffect(() => {
    if (!material) {
      setShown(false);
      setEditing(false);
      const timer = setTimeout(() => setMounted(false), ANIM_MS);
      return () => clearTimeout(timer);
    }
    setShown(true);
  }, [material]);

  useEffect(() => {
    if (!material) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [material, onClose]);

  // 编辑态:每次进入以素材当前值重置草稿
  function startEdit() {
    if (!material) return;
    setTitle(material.title ?? '');
    setContent(material.rawContent);
    setEditing(true);
  }

  const contentEmpty = !content.trim();

  async function save() {
    if (!material || contentEmpty || saving) return;
    setSaving(true);
    const ok = await onUpdate(material.id, { title: title.trim(), rawContent: content });
    setSaving(false);
    if (ok) setEditing(false);
  }

  if (!mounted) return null;

  const typeLabel = material ? t(`materialType.${material.type}`) : '';
  const charCount = material ? material.rawContent.length : 0;

  let body;
  if (!material) {
    body = null;
  } else if (editing) {
    body = (
      <>
        <p className="shrink-0 text-[11px] text-text-muted">{t('materialModal.editHint')}</p>
        <div className="mt-3 shrink-0">
          <label
            htmlFor="material-modal-title"
            className="text-xs font-medium text-text-primary"
          >
            {t('materialModal.titleLabel')}
          </label>
          <input
            id="material-modal-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('materialModal.titlePlaceholder')}
            className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
          />
        </div>
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <label htmlFor="material-modal-body" className="shrink-0 text-xs font-medium text-text-primary">
            {t('materialModal.bodyLabel')}
          </label>
          <textarea
            id="material-modal-body"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            className="mt-1.5 min-h-0 w-full flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
          />
          {contentEmpty && (
            <p className="mt-1 shrink-0 text-[11px] text-danger">
              {t('materialContentRequired')}
            </p>
          )}
        </div>
        <div className="mt-4 flex shrink-0 justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
            className="h-8 rounded-lg border border-border px-3 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={contentEmpty || saving}
            className="h-8 rounded-full bg-accent px-4 text-xs font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t('materialSaving') : t('materialModal.save')}
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        {/* 元信息:类型 · 字数 · 录入时间 */}
        <p className="shrink-0 text-[11px] text-text-muted">
          {t('materialModal.meta', {
            type: typeLabel,
            chars: charCount,
            time: formatAdded(material.createdAt, locale),
          })}
        </p>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-text-primary">
            {material.rawContent}
          </p>
        </div>
      </>
    );
  }

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
        aria-label={editing ? t('materialModal.editTitle') : material?.title || t('materialUntitled')}
        className={`relative flex max-h-[80vh] w-[640px] max-w-[92vw] flex-col rounded-[12px] bg-surface p-[22px] shadow-xl transition-all duration-[120ms] ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        }`}
      >
        {/* 头部:查看态 = 类型徽章 + 素材名;编辑态 = 图标块 + 「编辑素材」 */}
        <div className="flex shrink-0 items-center gap-2.5">
          {editing ? (
            <>
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-accent-dim text-[10px] font-bold text-accent">
                TXT
              </span>
              <h2 className="min-w-0 truncate text-[17px] font-bold tracking-tight text-text-primary">
                {t('materialModal.editTitle')}
              </h2>
            </>
          ) : (
            <>
              <span className="inline-flex shrink-0 items-center rounded-full bg-accent-dim px-2 py-0.5 text-[11px] font-medium text-accent">
                {typeLabel}
              </span>
              <h2 className="min-w-0 truncate text-[17px] font-bold tracking-tight text-text-primary">
                {material?.title || t('materialUntitled')}
              </h2>
            </>
          )}
          <span className="min-w-0 flex-1" />
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              aria-label={t('materialEdit')}
              className="flex h-[26px] shrink-0 items-center gap-1 rounded-md px-2 text-[11px] text-text-secondary transition-colors duration-[80ms] hover:bg-surface-2 hover:text-text-primary"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M14.5 5.5l4 4L8 20H4v-4z" />
                <path d="M12.5 7.5l4 4" />
              </svg>
              {t('materialModal.edit')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('materialModal.close')}
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] text-text-secondary transition-colors duration-[80ms] hover:text-text-primary"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {body}
      </div>
    </div>,
    document.body,
  );
}
