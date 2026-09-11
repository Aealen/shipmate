'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DragEvent } from 'react';
import type { TaskRow } from '@shipmate/core';
import { StatusBadge } from '@/components/shared/badge';

/**
 * 看板任务卡(P5)。
 * - HTML5 原生拖拽:dragstart 把任务 id 写入 dataTransfer;拖拽中原位卡片呈现
 *   抬起态——阴影 + scale(1.02),120ms(spec §14);抬起类延迟一帧再加,
 *   保证浏览器在 dragstart 同步截取的拖拽影像是卡片原貌。
 * - needs_reassessment 卡:danger 警示顶条 + 「确认重估」按钮(P5c 弹窗入口),
 *   整卡点击跳对应需求点详情 P4(spec §14 跳转关系)。
 */
export function TaskCard({
  task,
  pointTitle,
  projectId,
  dragging,
  onDragStart,
  onDragEnd,
  onConfirmReassess,
}: {
  task: TaskRow;
  pointTitle?: string;
  projectId: string;
  dragging: boolean;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onConfirmReassess: (task: TaskRow) => void;
}) {
  const t = useTranslations('board');
  const router = useRouter();
  const needsReassess = task.status === 'needs_reassessment';

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(task.id);
  }

  return (
    <div
      data-task-card
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={needsReassess ? () => router.push(`/project/${projectId}/points/${task.requirementPointId}`) : undefined}
      className={`relative flex cursor-grab flex-col gap-1.5 rounded-lg border border-border bg-surface p-3 shadow-sm transition-all duration-[120ms] active:cursor-grabbing ${
        dragging ? 'scale-[1.02] opacity-60 shadow-xl' : 'hover:border-accent'
      } ${needsReassess ? 'cursor-pointer' : ''}`}
    >
      {needsReassess && (
        <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-[inherit] bg-danger" aria-hidden />
      )}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-text-primary">
          {task.title}
        </p>
        <StatusBadge status={task.status} size="sm" />
      </div>
      {task.description && (
        <p className="line-clamp-2 text-xs leading-relaxed text-text-muted">{task.description}</p>
      )}
      {pointTitle && (
        <p className="truncate text-[11px] text-text-muted" title={pointTitle}>
          {pointTitle}
        </p>
      )}
      {needsReassess && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onConfirmReassess(task);
          }}
          className="mt-1 inline-flex h-7 shrink-0 items-center self-start rounded-md bg-danger px-2.5 text-xs font-medium text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97]"
        >
          {t('confirmReassess')}
        </button>
      )}
    </div>
  );
}
