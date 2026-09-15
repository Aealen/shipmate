'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { MaterialRow } from '@shipmate/core';
import { EmptyState } from '@/components/shared/empty-state';

const MATERIAL_TYPES = ['paste_text', 'screenshot_text', 'doc'] as const;

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

/**
 * P3c 左栏:本批素材列表 + 底部「新增素材」边框区 + 最底「开始分析」。
 * 写操作经 workbench 下发的回调(onAdd/onUpdate/onStart),本组件只管表单与展示。
 */
export function MaterialPanel({
  materials,
  runStatus,
  runError,
  analyzing,
  onStart,
  onAdd,
  onUpdate,
}: {
  materials: MaterialRow[];
  runStatus: 'pending' | 'done' | 'failed' | null;
  /** 分析失败摘要(spec §3.2 run.error);null = 旧失败数据,横幅维持现状文案 */
  runError: string | null;
  analyzing: boolean;
  onStart: () => void;
  onAdd: (input: {
    type: MaterialRow['type'];
    title: string;
    rawContent: string;
  }) => Promise<boolean>;
  onUpdate: (
    id: string,
    input: { title: string; rawContent: string },
  ) => Promise<boolean>;
}) {
  const t = useTranslations('analysis');
  const [type, setType] = useState<MaterialRow['type']>('paste_text');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [adding, setAdding] = useState(false);
  const canStart = materials.length > 0 && !analyzing;

  async function submit() {
    if (!content.trim() || adding) return;
    setAdding(true);
    const ok = await onAdd({ type, title: title.trim(), rawContent: content });
    setAdding(false);
    if (ok) {
      setTitle('');
      setContent('');
    }
  }

  return (
    // 面板外壳透明(原型 P3c 加强:左右栏为暖纸底上的透明分区,内容卡为白卡)
    <section className="flex min-h-0 w-[380px] shrink-0 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-[15px] font-bold tracking-tight text-text-primary">
          {t('materialSection')}
        </h2>
        <span className="text-xs text-text-muted">
          {t('materialCount', { count: materials.length })}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {materials.length === 0 ? (
          <EmptyState title={t('materialEmptyTitle')} description={t('materialEmptyDesc')} />
        ) : (
          <ul className="space-y-2">
            {materials.map((m) => (
              <MaterialCard key={m.id} material={m} onUpdate={onUpdate} />
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

      <div className="shrink-0 border-t border-border p-4">
        <p className="text-xs font-semibold text-text-secondary">{t('addMaterial.title')}</p>
        <div className="mt-2 space-y-2 rounded-lg border border-dashed border-border p-3">
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MaterialRow['type'])}
              aria-label={t('addMaterial.type')}
              className={`${FIELD_INPUT} h-8 shrink-0`}
            >
              {MATERIAL_TYPES.map((v) => (
                <option key={v} value={v}>
                  {t(`materialType.${v}`)}
                </option>
              ))}
            </select>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('addMaterial.materialTitle')}
              className={`${FIELD_INPUT} h-8 min-w-0 flex-1`}
            />
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('addMaterial.contentPlaceholder')}
            rows={3}
            className={`${FIELD_INPUT} resize-y py-1.5`}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={!content.trim() || adding}
              className="h-8 rounded-full bg-accent px-3.5 text-xs font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adding ? t('addMaterial.submitting') : t('addMaterial.submit')}
            </button>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-4">
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-ai text-sm font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SparkIcon spinning={analyzing} />
          {analyzing ? t('analyzing') : t('startAnalysis')}
        </button>
      </div>
    </section>
  );
}

/**
 * 单张素材卡:展示态 hover 出 ✏ 进入编辑态(title input + 原文 textarea + 保存/取消),
 * 编辑只影响本卡。空标题允许(core 置 null 后回退「未命名素材」);原文必填非空,
 * 空白时禁保存并内联提示。「调整素材后重试分析」即在此编辑。
 */
function MaterialCard({
  material,
  onUpdate,
}: {
  material: MaterialRow;
  onUpdate: (
    id: string,
    input: { title: string; rawContent: string },
  ) => Promise<boolean>;
}) {
  const t = useTranslations('analysis');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(material.title ?? '');
  const [content, setContent] = useState(material.rawContent);
  const [saving, setSaving] = useState(false);
  const contentEmpty = !content.trim();
  // textarea 高度按内容行数自适应(3~12 行封顶,超长滚动)
  const rows = Math.min(12, Math.max(3, content.split('\n').length));

  /** 进入编辑态:每次以素材当前值重置草稿,放弃/保存后不留脏数据 */
  function startEdit() {
    setTitle(material.title ?? '');
    setContent(material.rawContent);
    setEditing(true);
  }

  async function save() {
    if (contentEmpty || saving) return;
    setSaving(true);
    const ok = await onUpdate(material.id, { title: title.trim(), rawContent: content });
    setSaving(false);
    if (ok) setEditing(false);
  }

  if (!editing) {
    return (
      <li className="group rounded-lg border border-border p-3 transition-colors duration-[120ms] hover:border-accent">
        <div className="flex items-center gap-2">
          <span className="inline-flex shrink-0 items-center rounded-full bg-accent-dim px-2 py-0.5 text-[11px] font-medium text-accent">
            {t(`materialType.${material.type}`)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
            {material.title || t('materialUntitled')}
          </span>
          <button
            type="button"
            onClick={startEdit}
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
        <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{material.rawContent}</p>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-accent p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('addMaterial.materialTitle')}
        className={`${FIELD_INPUT} h-8`}
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={rows}
        className={`${FIELD_INPUT} mt-2 resize-y py-1.5`}
      />
      {contentEmpty && (
        <p className="mt-1 text-[11px] text-danger">{t('materialContentRequired')}</p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="h-7 rounded-lg border border-border px-3 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('cancel')}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={contentEmpty || saving}
          className="h-7 rounded-full bg-accent px-3.5 text-xs font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? t('materialSaving') : t('block.save')}
        </button>
      </div>
    </li>
  );
}
