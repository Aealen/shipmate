'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { PointPageData } from '@/actions/points';
import { setRequirementPointStatusAction } from '@/actions/points';
import { StatusBadge, type BadgeStatus } from '@/components/shared/badge';
import { showToast } from '@/components/shared/toast';
import { EditPointModal } from './edit-point-modal';
import { Evidences } from './evidences';
import { HistoryTimeline } from './history-timeline';
import { TasksPanel } from './tasks-panel';

/**
 * spec §4.1 显式流转表在 UI 侧的镜像:draft 可确认、confirmed 可开工、
 * developing 可完工;done 无可流转动作(core 侧兜底 INVALID_STATUS_TRANSITION)。
 */
const NEXT_TRANSITION: Partial<
  Record<
    BadgeStatus,
    { action: 'confirm' | 'start' | 'complete'; labelKey: string; next: BadgeStatus }
  >
> = {
  draft: { action: 'confirm', labelKey: 'confirm', next: 'confirmed' },
  confirmed: { action: 'start', labelKey: 'start', next: 'developing' },
  developing: { action: 'complete', labelKey: 'complete', next: 'done' },
};

/**
 * P4 需求点详情:面包屑(项目 › 需求 › 需求点)+ 状态/版本/流转头部 +
 * 描述、溯源依据、关联任务、变更历史四个区块 + P4b 编辑弹窗入口。
 * 写操作经 server actions;action 内 revalidatePath 使页面自动刷新。
 */
export function PointDetailView({ data, projectId }: { data: PointPageData; projectId: string }) {
  const t = useTranslations('pointDetail');
  const tBadge = useTranslations('shared.badge');
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { point } = data;

  const transition = NEXT_TRANSITION[point.status];
  const runTransition = () => {
    if (!transition) return;
    startTransition(async () => {
      const res = await setRequirementPointStatusAction(point.id, transition.action);
      if (res.ok) {
        showToast(t('transitionDone', { status: tBadge(`badge.${res.data.status}`) }));
      } else {
        showToast(res.message, 'error');
      }
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
      {/* 面包屑:项目 › 需求 › 需求点(需求列表在 P3 分析页) */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm">
        <Link
          href={`/project/${projectId}`}
          className="text-text-muted transition-colors hover:text-accent"
        >
          {data.project.name}
        </Link>
        <span className="text-text-muted">/</span>
        <Link
          href={`/project/${projectId}/analysis`}
          className="text-text-muted transition-colors hover:text-accent"
        >
          {data.requirement.title}
        </Link>
        <span className="text-text-muted">/</span>
        <span className="text-text-primary">{point.title}</span>
      </nav>

      {/* 头部:标题 + 状态徽章 + 版本 + 编辑入口 + 流转按钮 */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold leading-snug text-text-primary">
                {point.title}
              </h1>
              <StatusBadge status={point.status} />
              <span
                title={t('versionTitle')}
                className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text-secondary"
              >
                {t('versionBadge', { version: point.version })}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-text-secondary transition-[transform,border-color,color] duration-[80ms] hover:border-accent hover:text-accent active:scale-[0.97]"
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
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
            {t('edit')}
          </button>
        </div>

        {transition && (
          <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
            <span className="text-xs text-text-muted">{t('transitionHint')}</span>
            <button
              type="button"
              onClick={runTransition}
              disabled={pending}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:opacity-60"
            >
              {t(`transition.${transition.labelKey}`)}
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
            <span className="text-xs text-text-muted">
              {tBadge(`badge.${point.status}`)} → {tBadge(`badge.${transition.next}`)}
            </span>
          </div>
        )}
      </section>

      {/* 描述 */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-[13px] font-medium text-text-secondary">{t('description')}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
          {point.description || <span className="text-text-muted">{t('descriptionEmpty')}</span>}
        </p>
      </section>

      {/* 溯源依据 */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-[13px] font-medium text-text-secondary">{t('evidences')}</h2>
        <div className="mt-3">
          <Evidences evidences={point.evidences ?? []} materialTitles={data.materialTitles} />
        </div>
      </section>

      {/* 关联任务(含待重估任务的「确认重估」入口) */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-text-secondary">{t('tasks')}</h2>
          {data.tasks.length > 0 && (
            <span className="text-xs text-text-muted">
              {t('tasksCount', { count: data.tasks.length })}
            </span>
          )}
        </div>
        <div className="mt-3">
          <TasksPanel tasks={data.tasks} />
        </div>
      </section>

      {/* 变更历史时间线 */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-[13px] font-medium text-text-secondary">{t('history')}</h2>
        <div className="mt-4">
          <HistoryTimeline changeLogs={data.changeLogs} />
        </div>
      </section>

      {/* P4b 编辑弹窗:标题/描述 + reason 必填 + 联动预览 */}
      <EditPointModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        point={point}
        tasks={data.tasks}
      />
    </div>
  );
}
