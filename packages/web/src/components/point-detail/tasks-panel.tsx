'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { confirmTaskReassessmentAction, getTaskChangeLogs } from '@/actions/tasks';
import type { TaskRow } from '@shipmate/core';
import { StatusBadge } from '@/components/shared/badge';
import { Modal } from '@/components/shared/modal';
import { showToast } from '@/components/shared/toast';

/** 重估确认弹窗上下文:任务 + 懒加载的进入重估原因 */
interface ReassessTarget {
  task: TaskRow;
  /** 最近一条 status_change 日志的 reason(core 侧联动写入);null = 查询中或无记录 */
  reason: string | null;
}

/**
 * P4 关联任务列表:任务标题 + 状态徽章;needs_reassessment 任务提供
 * 「确认重估」入口(确认后回 pending,与看板 P5c 同一 core 动作)。
 */
export function TasksPanel({ tasks }: { tasks: TaskRow[] }) {
  const t = useTranslations('pointDetail');

  if (tasks.length === 0) {
    return <p className="text-sm text-text-muted">{t('tasksEmpty')}</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {tasks.map((task) => (
        <TaskRowItem key={task.id} task={task} />
      ))}
    </ul>
  );
}

function TaskRowItem({ task }: { task: TaskRow }) {
  const t = useTranslations('pointDetail');
  const [target, setTarget] = useState<ReassessTarget | null>(null);
  const [confirming, setConfirming] = useState(false);

  /** 打开弹窗并懒加载该任务最近 status_change 的 reason(进入重估原因) */
  const openReassess = (task: TaskRow) => {
    setTarget({ task, reason: null });
    getTaskChangeLogs(task.id)
      .then((logs) => {
        const reason = logs.find((l) => l.changeType === 'status_change')?.reason ?? null;
        setTarget((prev) => (prev?.task.id === task.id ? { task, reason } : prev));
      })
      .catch(() => {
        // 日志查询失败不阻塞确认,展示「无记录」兜底
        setTarget((prev) => (prev?.task.id === task.id ? { task, reason: '' } : prev));
      });
  };

  const confirmReassess = async () => {
    if (!target) return;
    setConfirming(true);
    const res = await confirmTaskReassessmentAction(target.task.id);
    setConfirming(false);
    if (res.ok) {
      showToast(t('reassessDone'));
      setTarget(null);
    } else {
      showToast(res.message, 'error');
    }
  };

  return (
    <>
      <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-text-primary">{task.title}</p>
          {task.commitRefs && task.commitRefs.length > 0 && (
            <p className="mt-0.5 truncate font-mono text-xs text-text-muted">
              {task.commitRefs.join(' ')}
            </p>
          )}
        </div>
        <StatusBadge status={task.status} size="sm" />
        {task.status === 'needs_reassessment' && (
          <button
            type="button"
            onClick={() => openReassess(task)}
            className="shrink-0 rounded-lg border border-danger/60 px-2.5 py-1 text-xs font-medium text-danger transition-transform duration-[80ms] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] active:scale-[0.97]"
          >
            {t('confirmReassessment')}
          </button>
        )}
      </li>

      <Modal open={target !== null} onClose={() => setTarget(null)} title={t('reassessTitle')}>
        {target && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">{t('reassessDesc')}</p>
            <div>
              <p className="text-xs text-text-muted">{t('reassessReason')}</p>
              <p className="mt-1 rounded-md bg-surface-2 px-3 py-2 text-sm text-text-primary">
                {target.reason === null ? '…' : target.reason || t('reassessNoReason')}
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTarget(null)}
                className="h-8 rounded-lg border border-border px-3 text-sm text-text-secondary transition-colors hover:bg-surface-2"
              >
                {t('reassessCancel')}
              </button>
              <button
                type="button"
                onClick={confirmReassess}
                disabled={confirming}
                className="h-8 rounded-md bg-danger px-3.5 text-sm font-medium text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:opacity-60"
              >
                {t('confirmReassessment')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
