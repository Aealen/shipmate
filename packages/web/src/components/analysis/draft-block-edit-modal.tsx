'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/shared/modal';

/**
 * 工作台草稿需求块编辑弹窗(spec §9 规则 9b 调整:块标题/摘要从原位 input
 * 改为弹窗编辑——原位 input 易误触且不美观)。编辑仅作用于前端草稿 state,
 * 点「应用」前不写库。
 */
export function DraftBlockEditModal({
  open,
  onClose,
  onSave,
  initialTitle,
  initialSummary,
}: {
  open: boolean;
  onClose: () => void;
  /** 保存(父级写回草稿 state);title 空白时按钮禁用 */
  onSave: (input: { title: string; summary: string }) => void;
  initialTitle: string;
  initialSummary: string;
}) {
  const t = useTranslations('analysis.blockEdit');
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setSummary(initialSummary);
    }
  }, [open, initialTitle, initialSummary]);

  const titleEmpty = !title.trim();

  return (
    <Modal open={open} onClose={onClose} title={t('title')}>
      <label htmlFor="draft-block-title" className="text-xs font-medium text-text-primary">
        {t('titleLabel')}
      </label>
      <input
        id="draft-block-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('titlePlaceholder')}
        className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
      />
      <label
        htmlFor="draft-block-summary"
        className="mt-3 block text-xs font-medium text-text-primary"
      >
        {t('summaryLabel')}
      </label>
      <textarea
        id="draft-block-summary"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder={t('summaryPlaceholder')}
        rows={4}
        className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-lg border border-border px-3 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
        >
          {t('cancel')}
        </button>
        <button
          type="button"
          onClick={() => onSave({ title: title.trim(), summary })}
          disabled={titleEmpty}
          className="h-8 rounded-full bg-accent px-4 text-xs font-bold text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('save')}
        </button>
      </div>
    </Modal>
  );
}
