'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DragEvent } from 'react';
import type { TaskRow } from '@shipmate/core';

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
      onClick={
        needsReassess
          ? () => router.push(`/project/${projectId}/points/${task.requirementPointId}`)
          : undefined
      }
      className={`relative flex cursor-grab flex-col gap-2 rounded-[9px] bg-surface p-3 transition-all duration-[120ms] active:cursor-grabbing ${
        dragging ? 'scale-[1.02] opacity-60 shadow-xl' : 'hover:shadow-sm'
      } ${needsReassess ? 'cursor-pointer' : ''}`}
    >
      {/* 原型 P5:重估卡顶部 2px 橙色警示条 */}
      {needsReassess && (
        <div
          className="absolute inset-x-0 top-0 h-[2px] rounded-t-[inherit] bg-warning"
          aria-hidden
        />
      )}
      <p className="w-full text-[13px] font-bold leading-snug text-text-primary">{task.title}</p>
      <div className="flex items-center gap-1.5">
        {pointTitle && (
          <p className="min-w-0 truncate text-[10px] text-text-muted" title={pointTitle}>
            {pointTitle}
          </p>
        )}
        <span className="min-w-0 flex-1" />
        <span className="shrink-0 text-[10px] tabular-nums text-text-muted">
          {formatCardTime(task.updatedAt)}
        </span>
      </div>
      {needsReassess && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onConfirmReassess(task);
          }}
          className="mt-0.5 inline-flex h-7 w-full shrink-0 items-center justify-center rounded-full bg-accent px-4 text-[11px] font-bold text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97]"
        >
          {t('confirmReassess')}
        </button>
      )}
    </div>
  );
}

/** 卡片右下角短时间:今天 HH:mm,否则 MM/dd */
function formatCardTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}
