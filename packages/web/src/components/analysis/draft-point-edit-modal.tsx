'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/shared/modal';

/**
 * 工作台草稿需求点编辑弹窗(spec §9 规则 9b 调整:编辑从原地表单改为 Modal)。
 * 编辑仅作用于前端草稿 state,点「应用」前不写库。
 */
export function DraftPointEditModal({
  open,
  onClose,
  onSave,
  initialTitle,
  initialDescription,
  initialDeadline,
}: {
  open: boolean;
  onClose: () => void;
  /** 保存(父级写回草稿 state);title 空白时按钮禁用 */
  onSave: (input: { title: string; description: string; deadline: string | null }) => void;
  initialTitle: string;
  initialDescription: string;
  /** Deadline(spec §9 规则 11):YYYY-MM-DD;空串 = 未设置 */
  initialDeadline: string;
}) {
  const t = useTranslations('analysis.pointEdit');
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [deadline, setDeadline] = useState(initialDeadline);

  // 打开时以所选点当前值重置草稿
  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setDescription(initialDescription);
      setDeadline(initialDeadline);
    }
  }, [open, initialTitle, initialDescription, initialDeadline]);

  const titleEmpty = !title.trim();

  return (
    <Modal open={open} onClose={onClose} title={t('title')}>
      <label htmlFor="draft-point-title" className="text-xs font-medium text-text-primary">
        {t('titleLabel')}
      </label>
      <input
        id="draft-point-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('titlePlaceholder')}
        className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
      />
      <label
        htmlFor="draft-point-desc"
        className="mt-3 block text-xs font-medium text-text-primary"
      >
        {t('descLabel')}
      </label>
      <textarea
        id="draft-point-desc"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t('descPlaceholder')}
        rows={6}
        className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
      />
      <label
        htmlFor="draft-point-deadline"
        className="mt-3 block text-xs font-medium text-text-primary"
      >
        {t('deadlineLabel')}
      </label>
      <input
        id="draft-point-deadline"
        type="date"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
        className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
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
          onClick={() => onSave({ title: title.trim(), description, deadline: deadline || null })}
          disabled={titleEmpty}
          className="h-8 rounded-full bg-accent px-4 text-xs font-bold text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('save')}
        </button>
      </div>
    </Modal>
  );
}
