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
 * 流转按钮按目标状态着色(原型 P4:完成=绿):confirmed=accent、
 * developing=warning、done=success。
 */
const NEXT_TRANSITION: Partial<
  Record<
    BadgeStatus,
    { action: 'confirm' | 'start' | 'complete'; labelKey: string; next: BadgeStatus; btn: string }
  >
> = {
  draft: { action: 'confirm', labelKey: 'confirm', next: 'confirmed', btn: 'bg-accent' },
  confirmed: { action: 'start', labelKey: 'start', next: 'developing', btn: 'bg-warning' },
  developing: { action: 'complete', labelKey: 'complete', next: 'done', btn: 'bg-success' },
};

/**
 * P4 需求点详情(对齐原型 P4 双栏):左栏=标题/状态/版本 + 流转与编辑操作 +
 * 描述 + 溯源依据;右栏=关联任务 + 变更历史。面包屑横跨顶部。
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
        showToast(t('transitionDone', { status: tBadge(res.data.status) }));
      } else {
        showToast(res.message, 'error');
      }
    });
  };

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      {/* 面包屑:项目 › 需求 › 需求点(需求列表在 P3 分析页) */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px]">
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
        <span className="text-text-secondary">{point.title}</span>
      </nav>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* 左栏:标题 + 操作 + 描述 + 溯源 */}
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="min-w-0 flex-1 text-base font-bold leading-snug text-text-primary">
              {point.title}
            </h1>
            <StatusBadge status={point.status} />
            <span
              title={t('versionTitle')}
              className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] leading-none text-text-secondary"
            >
              v{point.version}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {transition && (
              <button
                type="button"
                onClick={runTransition}
                disabled={pending}
                className={`inline-flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-xs font-bold text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:opacity-60 ${transition.btn}`}
              >
                ✓ {t(`transition.${transition.labelKey}`)}
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-xs font-bold text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97]"
            >
              ✎ {t('edit')}
            </button>
            {transition && (
              <span className="text-[11px] text-text-muted">
                {tBadge(point.status)} → {tBadge(transition.next)}
              </span>
            )}
          </div>

          {/* 描述 */}
          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-bold text-text-primary">{t('description')}</h2>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">
              {point.description || (
                <span className="text-text-muted">{t('descriptionEmpty')}</span>
              )}
            </p>
          </section>

          {/* 溯源依据 */}
          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-bold text-text-primary">{t('evidences')}</h2>
            <Evidences evidences={point.evidences ?? []} materialTitles={data.materialTitles} />
          </section>
        </div>

        {/* 右栏:关联任务 + 变更历史 */}
        <div className="flex min-w-0 flex-col gap-5">
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-bold text-text-primary">{t('tasks')}</h2>
              {data.tasks.length > 0 && (
                <span className="text-[11px] text-text-muted">
                  {t('tasksCount', { count: data.tasks.length })}
                </span>
              )}
            </div>
            <TasksPanel tasks={data.tasks} />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-bold text-text-primary">{t('history')}</h2>
            <HistoryTimeline changeLogs={data.changeLogs} />
          </section>
        </div>
      </div>

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
