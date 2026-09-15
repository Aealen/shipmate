'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { getTaskChangeLogs, confirmTaskReassessmentAction } from '@/actions/tasks';
import { Modal } from '@/components/shared/modal';
import { showToast } from '@/components/shared/toast';

/**
 * P5c 重估确认弹窗:展示该任务进入 needs_reassessment 的原因
 * (取最近一条 status_change 变更日志的 reason,由需求点实质修改联动写入,
 * 见 core RequirementPointService.updateRequirementPoint),
 * 确认调 confirm_task_reassessment,任务回 pending,原完成记录留审计。
 */
export function ReassessModal({
  open,
  taskId,
  taskTitle,
  pointId,
  pointTitle,
  projectId,
  onClose,
}: {
  open: boolean;
  taskId: string | null;
  taskTitle: string;
  pointId: string | null;
  pointTitle?: string;
  projectId: string;
  onClose: () => void;
}) {
  const t = useTranslations('board');
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 打开时异步取该任务最近 status_change 日志的 reason
  useEffect(() => {
    if (!open || !taskId) return;
    let alive = true;
    setLoading(true);
    getTaskChangeLogs(taskId)
      .then((logs) => {
        if (!alive) return;
        setReason(logs.find((l) => l.changeType === 'status_change')?.reason ?? null);
      })
      .catch(() => {
        if (alive) setReason(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, taskId]);

  async function handleConfirm() {
    if (!taskId || submitting) return;
    setSubmitting(true);
    const res = await confirmTaskReassessmentAction(taskId);
    setSubmitting(false);
    if (res.ok) {
      showToast(t('reassessSuccess'));
      onClose();
    } else {
      showToast(res.message, 'error');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('reassessTitle')}>
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-text-primary">{taskTitle}</p>

        <div>
          <p className="text-xs text-text-secondary">{t('reassessReasonLabel')}</p>
          <div className="mt-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm leading-relaxed text-text-primary">
            {loading ? (
              <span className="text-text-muted">{t('reassessReasonLoading')}</span>
            ) : reason ? (
              reason
            ) : (
              <span className="text-text-muted">{t('reassessReasonEmpty')}</span>
            )}
          </div>
        </div>

        {pointId && (
          <a
            href={`/project/${projectId}/points/${pointId}`}
            className="inline-flex items-center gap-1 self-start text-sm text-accent transition-opacity duration-[120ms] hover:opacity-80"
          >
            {pointTitle ?? t('reassessPointLink')}
            <span aria-hidden>›</span>
          </a>
        )}

        <p className="text-xs leading-relaxed text-text-muted">{t('reassessNote')}</p>

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm text-text-secondary transition-colors duration-[120ms] hover:bg-surface-2"
          >
            {t('reassessCancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="inline-flex h-8 items-center rounded-full bg-accent px-4 text-sm font-medium text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:opacity-60"
          >
            {t('confirmReassess')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
