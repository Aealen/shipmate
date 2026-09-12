'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { RequirementPointRow, TaskRow } from '@shipmate/core';
import { updateRequirementPointAction } from '@/actions/points';
import { Modal } from '@/components/shared/modal';
import { showToast } from '@/components/shared/toast';

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors duration-[120ms] placeholder:text-text-muted focus:border-accent';

/**
 * P4b 实质修改编辑弹窗:标题/描述 + reason 必填(spec §5.3)。
 * 提交前在前端按当前数据预览联动后果:version+1、developing/done 状态回退
 * confirmed、非待重估关联任务 N 个转 needs_reassessment——与 core
 * updateRequirementPoint 的事务语义一一对应,仅作展示,以后端为准。
 */
export function EditPointModal({
  open,
  onClose,
  point,
  tasks,
}: {
  open: boolean;
  onClose: () => void;
  point: RequirementPointRow;
  tasks: TaskRow[];
}) {
  const t = useTranslations('pointDetail.editModal');
  const tBadge = useTranslations('shared.badge');

  const [title, setTitle] = useState(point.title);
  const [description, setDescription] = useState(point.description ?? '');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 每次打开重置为当前值(编辑中路由自动刷新不打断输入)
  useEffect(() => {
    if (open) {
      setTitle(point.title);
      setDescription(point.description ?? '');
      setReason('');
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 联动预览:与 core 的 substantive 判定同构(trim 标题、描述原文比较)
  const trimmedTitle = title.trim();
  const substantive = trimmedTitle !== point.title || description !== (point.description ?? '');
  const willRollback = substantive && (point.status === 'developing' || point.status === 'done');
  const affectedTaskCount = substantive
    ? tasks.filter((task) => task.status !== 'needs_reassessment').length
    : 0;
  const canSubmit = substantive && reason.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!reason.trim()) {
      showToast(t('reasonMissing'), 'error');
      return;
    }
    if (!substantive) return;
    setSubmitting(true);
    const res = await updateRequirementPointAction(point.id, {
      title: trimmedTitle,
      description,
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (res.ok) {
      showToast(t('success', { version: res.data.point.version }));
      onClose();
    } else {
      showToast(res.message, 'error');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('title')}>
      <div className="space-y-4">
        <div>
          <label htmlFor="edit-point-title" className="text-xs text-text-secondary">
            {t('titleLabel')}
          </label>
          <input
            id="edit-point-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className={`mt-1 ${inputClass}`}
          />
        </div>

        <div>
          <label htmlFor="edit-point-desc" className="text-xs text-text-secondary">
            {t('descriptionLabel')}
          </label>
          <textarea
            id="edit-point-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={`mt-1 resize-none ${inputClass}`}
          />
        </div>

        <div>
          <label htmlFor="edit-point-reason" className="text-xs text-text-secondary">
            {t('reasonLabel')} <span className="text-danger">*</span>
            <span className="ml-1 text-text-muted">({t('reasonRequiredMark')})</span>
          </label>
          <textarea
            id="edit-point-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t('reasonPlaceholder')}
            className={`mt-1 resize-none ${inputClass} ${reason.trim() ? '' : 'border-danger/50'}`}
          />
        </div>

        {/* 提交前联动预览:前端按当前数据计算,真实结果以 core 事务为准 */}
        <div className="rounded-md border border-border bg-surface-2 p-3">
          <p className="text-xs font-medium text-text-secondary">{t('impactPreview')}</p>
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {substantive ? (
              <>
                <PreviewLine>
                  {t('previewVersion', { from: point.version, to: point.version + 1 })}
                </PreviewLine>
                {willRollback && (
                  <PreviewLine tone="warning">
                    {t('previewRollback', {
                      from: tBadge(point.status),
                      to: tBadge('confirmed'),
                    })}
                  </PreviewLine>
                )}
                <PreviewLine tone={affectedTaskCount > 0 ? 'danger' : undefined}>
                  {affectedTaskCount > 0
                    ? t('previewTasks', { count: affectedTaskCount })
                    : t('previewTasksNone')}
                </PreviewLine>
              </>
            ) : (
              <PreviewLine>{t('previewNoChange')}</PreviewLine>
            )}
          </ul>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-border px-3 text-sm text-text-secondary transition-colors hover:bg-surface-2"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? t('submitting') : t('submit')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PreviewLine({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'warning' | 'danger';
}) {
  const color =
    tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-text-secondary';
  return (
    <li className={`flex items-start gap-1.5 ${color}`}>
      <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current" />
      <span>{children}</span>
    </li>
  );
}
