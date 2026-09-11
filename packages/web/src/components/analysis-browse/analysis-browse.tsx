'use client';

import type { RequirementPointRow, RequirementWithOverdue } from '@shipmate/core';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DueSoonBadge, OverdueBadge, StatusBadge } from '@/components/shared/badge';
import { EmptyState } from '@/components/shared/empty-state';
import { EvidenceModal } from './evidence-modal';

/** 素材分析批次卡数据(服务端已剥掉 draftResult 等重字段) */
export interface RunCardData {
  id: string;
  title: string | null;
  status: 'pending' | 'done' | 'failed';
  createdAt: number;
  completedAt: number | null;
  materialCount: number;
  draftRequirementCount: number;
}

export interface AnalysisBrowseProps {
  projectId: string;
  /** 「新增素材分析」与批次卡跳转目标(P3c 工作台路由) */
  newAnalysisHref: string;
  /** 需求点详情路由前缀,拼 `/${pointId}` 即详情地址(P4) */
  pointHrefBase: string;
  runs: RunCardData[];
  requirements: RequirementWithOverdue[];
  points: RequirementPointRow[];
  /** materialId → 素材标题(P3b 依据弹窗展示用) */
  materialTitles: Record<string, string>;
}

const PRIORITY_ORDER: Record<RequirementWithOverdue['priority'], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

/**
 * P3 需求分析页主体(双区,对齐原型 P3 帧):
 * 上半「素材分析记录」卡流——每卡 = 一次批次,点击进入工作台(?run=);
 * 下半「需求列表」——draft 置灰置顶,需求点行展开,行尾详情/原文依据入口。
 * 本组件纯只读,写操作都在工作台(C 组)与详情页。
 */
export function AnalysisBrowse({
  projectId,
  newAnalysisHref,
  pointHrefBase,
  runs,
  requirements,
  points,
  materialTitles,
}: AnalysisBrowseProps) {
  const t = useTranslations('browse');
  const locale = useLocale();
  const router = useRouter();

  // draft 置灰置顶待确认;其余按优先级 → 截止时间升序(无排期靠后)
  const sortedRequirements = useMemo(() => {
    const list = [...requirements];
    list.sort((a, b) => {
      const aDraft = a.status === 'draft';
      const bDraft = b.status === 'draft';
      if (aDraft !== bDraft) return aDraft ? -1 : 1;
      const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (byPriority !== 0) return byPriority;
      const aDue = a.planDueAt ?? Number.POSITIVE_INFINITY;
      const bDue = b.planDueAt ?? Number.POSITIVE_INFINITY;
      return aDue - bDue;
    });
    return list;
  }, [requirements]);

  const pointsByRequirement = useMemo(() => {
    const map = new Map<string, RequirementPointRow[]>();
    for (const p of points) {
      const list = map.get(p.requirementId);
      if (list) list.push(p);
      else map.set(p.requirementId, [p]);
    }
    return map;
  }, [points]);

  // 弹窗数据与开关分离:关闭只切 open,点数据保留至下次覆盖,退出动画期间内容不闪空
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidencePoint, setEvidencePoint] = useState<RequirementPointRow | null>(null);

  const openEvidence = (point: RequirementPointRow) => {
    setEvidencePoint(point);
    setEvidenceOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 p-6">
      {/* 上半:素材分析记录卡流 */}
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-text-primary">{t('runsTitle')}</h2>
          <Link
            href={newAnalysisHref}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t('newAnalysis')}
          </Link>
        </div>

        {runs.length === 0 ? (
          <EmptyState
            title={t('runsEmptyTitle')}
            description={t('runsEmptyDesc')}
            actionLabel={t('newAnalysis')}
            onAction={() => router.push(newAnalysisHref)}
          />
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {runs.map((run) => (
              <RunCard key={run.id} run={run} href={`${newAnalysisHref}?run=${run.id}`} />
            ))}
          </div>
        )}
      </section>

      {/* 下半:需求列表(draft 置灰置顶) */}
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-text-primary">{t('requirementsTitle')}</h2>
          <span className="shrink-0 text-xs text-text-muted">
            {t('requirementCount', { count: requirements.length })}
          </span>
        </div>

        {requirements.length === 0 ? (
          <EmptyState
            title={t('reqsEmptyTitle')}
            description={t('reqsEmptyDesc')}
            actionLabel={t('newAnalysis')}
            onAction={() => router.push(newAnalysisHref)}
          />
        ) : (
          <div className="mt-3 space-y-3">
            {sortedRequirements.map((req) => (
              <RequirementBlock
                key={req.id}
                requirement={req}
                points={pointsByRequirement.get(req.id) ?? []}
                pointHrefBase={pointHrefBase}
                onEvidence={openEvidence}
              />
            ))}
          </div>
        )}
      </section>

      {/* P3b 原文依据弹窗 */}
      <EvidenceModal
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        point={evidencePoint}
        materialTitles={materialTitles}
      />
    </div>
  );
}

/** 批次卡:标题/时间/素材数/草稿统计/状态徽章,点击进工作台带 ?run= */
function RunCard({ run, href }: { run: RunCardData; href: string }) {
  const t = useTranslations('browse');
  const locale = useLocale();

  return (
    <Link
      href={href}
      className="block rounded-xl border border-border bg-surface p-4 transition-colors duration-[120ms] hover:border-accent"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-medium text-text-primary">
          {run.title ?? t('runUntitled')}
        </h3>
        <StatusBadge status={run.status} size="sm" />
      </div>
      <p className="mt-2 text-xs text-text-muted">{formatDateTime(run.createdAt, locale)}</p>
      <div className="mt-3 flex items-center gap-3 text-xs text-text-secondary">
        <span>{t('runMaterials', { count: run.materialCount })}</span>
        {run.status === 'done' && (
          <span>{t('runDrafts', { count: run.draftRequirementCount })}</span>
        )}
      </div>
    </Link>
  );
}

/** 需求块:头部行可点开合需求点;draft 置灰 + 待确认提示;超期/临期徽章 */
function RequirementBlock({
  requirement: req,
  points,
  pointHrefBase,
  onEvidence,
}: {
  requirement: RequirementWithOverdue;
  points: RequirementPointRow[];
  pointHrefBase: string;
  onEvidence: (point: RequirementPointRow) => void;
}) {
  const t = useTranslations('browse');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const isDraft = req.status === 'draft';

  return (
    <div
      className={`rounded-xl border border-border bg-surface transition-colors duration-[120ms] hover:border-accent ${
        isDraft ? 'opacity-75' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 p-4 text-left"
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform duration-[120ms] ${
            open ? 'rotate-90' : ''
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span className="min-w-0 truncate text-[15px] font-medium text-text-primary">
          {req.title}
        </span>
        <StatusBadge status={req.status} size="sm" />
        {isDraft && <span className="text-xs text-draft-gray">{t('draftHint')}</span>}
        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
          {req.priority}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="text-xs text-text-muted">{planTimeText(req, t, locale)}</span>
          {req.dueSoon && <DueSoonBadge />}
          {req.overdue && <OverdueBadge days={req.overdueDays} />}
          <span className="text-xs text-text-muted">
            {t('pointsCount', { count: points.length })}
          </span>
        </span>
      </button>

      {open && points.length > 0 && (
        <ul className="border-t border-border">
          {points.map((p) => (
            <PointRow
              key={p.id}
              point={p}
              detailHref={`${pointHrefBase}/${p.id}`}
              onEvidence={() => onEvidence(p)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** 需求点行:标题 + 状态徽章 + 行尾「📄 原文依据」「详情 ›」 */
function PointRow({
  point,
  detailHref,
  onEvidence,
}: {
  point: RequirementPointRow;
  detailHref: string;
  onEvidence: () => void;
}) {
  const t = useTranslations('browse');

  return (
    <li className="flex items-center gap-2 py-2.5 pl-9 pr-4">
      <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{point.title}</span>
      <StatusBadge status={point.status} size="sm" />
      <button
        type="button"
        onClick={onEvidence}
        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-text-secondary transition-all duration-[80ms] hover:text-accent active:scale-[0.97]"
      >
        📄 {t('evidence')}
      </button>
      <Link
        href={detailHref}
        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-accent transition-opacity hover:opacity-80"
      >
        {t('detail')} ›
      </Link>
    </li>
  );
}

function formatDate(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit' }).format(ms);
}

function formatDateTime(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ms);
}

/** 计划时间文案:双时间显示区间,仅有截止显示「截止 x」,都无显示「未排期」 */
function planTimeText(
  req: RequirementWithOverdue,
  t: ReturnType<typeof useTranslations>,
  locale: string,
): string {
  if (req.planStartAt && req.planDueAt) {
    return t('planRange', {
      start: formatDate(req.planStartAt, locale),
      end: formatDate(req.planDueAt, locale),
    });
  }
  if (req.planDueAt) return t('planDue', { date: formatDate(req.planDueAt, locale) });
  return t('unscheduled');
}
