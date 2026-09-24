'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { AttachmentMeta, MaterialRow } from '@shipmate/core';
import { EmptyState } from '@/components/shared/empty-state';

/** ✦ 四角星(spec §14:分析按钮 loading 时旋转) */
function SparkIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`}
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
    </svg>
  );
}

const FIELD_INPUT =
  'w-full rounded-md border border-border bg-surface px-2.5 text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent';

/** 附件上传:multipart 落盘 /api/uploads,返回元数据(素材多附件) */
async function uploadFiles(files: File[]): Promise<AttachmentMeta[]> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const res = await fetch('/api/uploads', { method: 'POST', body: form });
  if (!res.ok) throw new Error('upload failed');
  const data = (await res.json()) as { files: AttachmentMeta[] };
  return data.files;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function isImage(a: AttachmentMeta): boolean {
  return a.mime.startsWith('image/');
}

/**
 * P3c 左栏(素材多附件模型):素材不再区分类型;新增素材 = 标题 + 内容 + 多附件
 * (拖入 / 粘贴 / 点击上传,附件先传 /api/uploads 再随素材提交)。
 * 素材卡点击打开详情 Modal,✏ 直达编辑态;写操作经 workbench 回调。
 */
export function MaterialPanel({
  materials,
  runStatus,
  runError,
  analyzing,
  onStart,
  onAdd,
  onOpen,
}: {
  materials: MaterialRow[];
  runStatus: 'pending' | 'done' | 'failed' | null;
  /** 分析失败摘要(spec §3.2 run.error);null = 旧失败数据,横幅维持现状文案 */
  runError: string | null;
  analyzing: boolean;
  onStart: () => void;
  onAdd: (input: {
    title: string;
    rawContent: string;
    attachments: AttachmentMeta[];
  }) => Promise<boolean>;
  /** 打开素材详情 Modal(edit = 直达编辑态;Modal 内保存走 workbench onUpdate) */
  onOpen: (material: MaterialRow, edit?: boolean) => void;
}) {
  const t = useTranslations('analysis');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canStart = materials.length > 0 && !analyzing;
  const canSubmit = (content.trim().length > 0 || attachments.length > 0) && !adding;

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    try {
      const metas = await uploadFiles(files);
      setAttachments((prev) => [...prev, ...metas]);
    } catch {
      // 上传失败静默保留已选,chips 不变;用户可重试
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!canSubmit) return;
    setAdding(true);
    const ok = await onAdd({ title: title.trim(), rawContent: content, attachments });
    setAdding(false);
    if (ok) {
      setTitle('');
      setContent('');
      setAttachments([]);
    }
  }

  return (
    <section className="flex min-h-0 w-[380px] shrink-0 flex-col">
      <header className="flex shrink-0 items-center justify-between px-1 pb-3">
        <h2 className="text-[15px] font-bold tracking-tight text-text-primary">
          {t('materialSection')}
        </h2>
        <span className="text-xs text-text-muted">
          {t('materialCount', { count: materials.length })}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {materials.length === 0 ? (
          <EmptyState title={t('materialEmptyTitle')} description={t('materialEmptyDesc')} />
        ) : (
          <ul className="space-y-2">
            {materials.map((m) => (
              <MaterialCard key={m.id} material={m} onOpen={onOpen} />
            ))}
          </ul>
        )}
        {runStatus === 'failed' && (
          <div className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2">
            <p className="text-xs text-danger">{t('analysisFailedState')}</p>
            {/* 失败原因摘要:截断两行,悬停看全文;旧失败数据无摘要时只显示提示行 */}
            {runError && (
              <p
                className="mt-1 line-clamp-2 break-all text-[11px] leading-snug text-danger"
                title={runError}
              >
                {runError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 新增素材:标题 + 内容 + 多附件(拖入/粘贴/点击上传),不再区分素材类型 */}
      <div
        className="shrink-0 rounded-lg border border-border bg-surface p-4"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void addFiles([...e.dataTransfer.files]);
        }}
      >
        <p className="text-xs font-semibold text-text-secondary">{t('addMaterial.title')}</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('addMaterial.materialTitle')}
          className={`${FIELD_INPUT} mt-2.5 h-8`}
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          placeholder={t('addMaterial.contentPlaceholder')}
          rows={3}
          className={`${FIELD_INPUT} mt-2 resize-y py-1.5`}
        />
        {attachments.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {attachments.map((a, i) => (
              <li
                key={`${a.path}-${i}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-2 pr-1 text-[11px] text-text-secondary"
                title={`${a.name} · ${formatSize(a.size)}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3 w-3 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  {isImage(a) ? (
                    <>
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="M21 15l-5-5L5 21" />
                    </>
                  ) : (
                    <>
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <path d="M14 2v6h6" />
                    </>
                  )}
                </svg>
                <span className="max-w-32 truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={t('addMaterial.removeAttachment', { name: a.name })}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:text-danger"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-2.5 w-2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.2}
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
          className={`mt-2 flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-md transition-colors duration-[120ms] ${
            dragOver ? 'bg-accent-dim' : 'bg-surface-2 hover:bg-accent-dim/50'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 text-text-muted"
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
          <span className="text-xs font-medium text-text-secondary">
            {uploading ? t('addMaterial.uploading') : t('addMaterial.dropzone')}
          </span>
          <span className="text-[10px] text-text-muted">{t('addMaterial.dropzoneHint')}</span>
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
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="h-8 rounded-full bg-accent px-3.5 text-xs font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {adding ? t('addMaterial.submitting') : t('addMaterial.submit')}
          </button>
        </div>
      </div>

      <div className="shrink-0 pb-1 pt-3">
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-accent text-sm font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SparkIcon spinning={analyzing} />
          {analyzing ? t('analyzing') : t('startAnalysis')}
        </button>
      </div>
    </section>
  );
}

/**
 * 单张素材卡:标题 + 摘要 + 附件数徽章(素材多附件);整卡点击打开详情 Modal,
 * hover 出 ✏ 直达编辑态(原型 P3m/P3m2)。
 */
function MaterialCard({
  material,
  onOpen,
}: {
  material: MaterialRow;
  onOpen: (material: MaterialRow, edit?: boolean) => void;
}) {
  const t = useTranslations('analysis');
  const attCount = material.attachments?.length ?? 0;

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onOpen(material)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(material);
      }}
      className="group cursor-pointer rounded-lg border border-border bg-surface p-3 outline-none transition-all duration-[120ms] hover:shadow-sm focus-visible:border-accent"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
          {material.title || t('materialUntitled')}
        </span>
        {attCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
            <svg
              viewBox="0 0 24 24"
              className="h-2.5 w-2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
            {attCount}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(material, true);
          }}
          aria-label={t('materialEdit')}
          title={t('materialEdit')}
          className="flex shrink-0 items-center rounded px-1 py-0.5 text-[11px] text-text-secondary opacity-0 transition-all duration-[80ms] hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
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
        </button>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
        {material.rawContent || t('materialNoText')}
      </p>
    </li>
  );
}
