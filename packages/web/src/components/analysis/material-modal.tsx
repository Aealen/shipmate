'use client';

import type { AttachmentMeta, MaterialRow } from '@shipmate/core';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  attachmentUrl,
  formatAttachmentSize,
  uploadAttachmentFiles,
} from '@/lib/uploads';

/**
 * 素材详情 Modal(原型 P3m 查看 / P3m2 编辑双态,素材多附件模型):
 * 查看态 = 附件数徽章 + 标题 + 编辑/关闭 + 元信息(字数 · 录入时间)+ 附件列表(预览/下载)+ 全文;
 * 编辑态 = 提示行 + 标题/原文表单 + 附件管理(移除/拖入/粘贴/点击追加)+ 取消/保存。
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
  onUpdate: (
    id: string,
    input: { title: string; rawContent: string; attachments?: AttachmentMeta[] },
  ) => Promise<boolean>;
}) {
  const t = useTranslations('analysis');
  const locale = useLocale();

  // mounted 控制渲染,shown 控制动画目标态;关闭动画期间保留 material 展示
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [editing, setEditing] = useState(startInEdit);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  /** 编辑态附件草稿:进入编辑时以素材当前值初始化,保存时全量回传 */
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 打开(或切换到另一条素材)时重置;同 id 行内更新(保存后回写)不重置,
  // 保持 save() 设置的查看态并展示新值
  const materialId = material?.id;
  useEffect(() => {
    if (material) {
      setEditing(startInEdit);
      if (startInEdit) {
        setTitle(material.title ?? '');
        setContent(material.rawContent);
        setAttachments(material.attachments ?? []);
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
    setAttachments(material.attachments ?? []);
    setEditing(true);
  }

  const contentEmpty = !content.trim() && attachments.length === 0;

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    try {
      const metas = await uploadAttachmentFiles(files);
      setAttachments((prev) => [...prev, ...metas]);
    } catch {
      // 上传失败静默保留已选;用户可重试
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!material || contentEmpty || saving) return;
    setSaving(true);
    const ok = await onUpdate(material.id, {
      title: title.trim(),
      rawContent: content,
      attachments,
    });
    setSaving(false);
    if (ok) setEditing(false);
  }

  if (!mounted) return null;

  const charCount = material ? material.rawContent.length : 0;
  const attCount = material?.attachments?.length ?? 0;

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
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            rows={8}
            className="mt-1.5 min-h-0 w-full flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
          />
          {contentEmpty && (
            <p className="mt-1 shrink-0 text-[11px] text-danger">
              {t('materialContentRequired')}
            </p>
          )}
        </div>
        {/* 附件管理:移除 / 拖入 / 粘贴 / 点击追加;保存时全量回传 */}
        <div className="mt-3 shrink-0">
          <p className="text-xs font-medium text-text-primary">
            {t('materialModal.attachments', { count: attachments.length })}
          </p>
          {attachments.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {attachments.map((a, i) => (
                <li
                  key={`${a.path}-${i}`}
                  className="flex h-8 items-center gap-2 rounded-md bg-surface-2 px-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
                    {a.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-muted">
                    {formatAttachmentSize(a.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={t('addMaterial.removeAttachment', { name: a.name })}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:text-danger"
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
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-1.5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-surface-2 text-xs font-medium text-text-secondary transition-colors hover:bg-accent-dim/50"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <path d="M17 8l-5-5-5 5" />
              <path d="M12 3v12" />
            </svg>
            {uploading ? t('addMaterial.uploading') : t('addMaterial.dropzone')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
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
        {/* 元信息:字数 · 附件数 · 录入时间 */}
        <p className="shrink-0 text-[11px] text-text-muted">
          {t('materialModal.metaNoType', {
            chars: charCount,
            count: attCount,
            time: formatAdded(material.createdAt, locale),
          })}
        </p>
        {attCount > 0 && (
          <div className="mt-2 shrink-0">
            <p className="text-[11px] font-medium text-text-muted">
              {t('materialModal.attachments', { count: attCount })}
            </p>
            <ul className="mt-1 space-y-1">
              {(material.attachments ?? []).map((a, i) => (
                <li
                  key={`${a.path}-${i}`}
                  className="flex h-9 items-center gap-2 rounded-md bg-surface-2 px-3"
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
                    {a.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-muted">
                    {formatAttachmentSize(a.size)}
                  </span>
                  <a
                    href={attachmentUrl(a)}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-[11px] font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {t('materialModal.preview')}
                  </a>
                  <a
                    href={attachmentUrl(a, 'attachment')}
                    className="shrink-0 text-[11px] font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {t('materialModal.download')}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-text-primary">
            {material.rawContent || t('materialNoText')}
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
        className={`relative flex max-h-[80vh] w-[640px] max-w-[92vw] flex-col rounded-md bg-surface p-[22px] shadow-xl transition-all duration-[120ms] ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        }`}
      >
        {/* 头部:查看态 = 附件数徽章 + 素材名;编辑态 = 「编辑素材」 */}
        <div className="flex shrink-0 items-center gap-2.5">
          {editing ? (
            <>
              <h2 className="min-w-0 truncate text-[17px] font-bold tracking-tight text-text-primary">
                {t('materialModal.editTitle')}
              </h2>
            </>
          ) : (
            <>
              {attCount > 0 && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-dim px-2 py-0.5 text-[11px] font-medium text-accent">
                  {t('materialModal.attachments', { count: attCount })}
                </span>
              )}
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
