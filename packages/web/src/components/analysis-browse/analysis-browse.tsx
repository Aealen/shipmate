'use client';

import type { RequirementPointRow, RequirementWithOverdue } from '@shipmate/core';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { getPointRevisionHistory, type RevisionEntry } from '@/actions/revisions';
import { DueSoonBadge, OverdueBadge, StatusBadge } from '@/components/shared/badge';
import { EmptyState } from '@/components/shared/empty-state';
import {
  ChevronIcon,
  ClockIcon,
  RevisionEntryRow,
  RevisionHistoryModal,
  formatDate,
  formatShort,
} from './revision-history-modal';
import { RequirementEditModal } from './requirement-edit-modal';
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
  /** 修订计数(键为 requirementId / pointId)——✨N 徽标用,0 视为无修订 */
  revisionCounts: Record<string, number>;
}

const PRIORITY_ORDER: Record<RequirementWithOverdue['priority'], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

/** 优先级徽章:P0/P1 红底白字、P2 橙底白字、P3 灰底(原型 P3 帧 P1=红) */
const PRIORITY_BADGE: Record<RequirementWithOverdue['priority'], string> = {
  P0: 'bg-danger text-white',
  P1: 'bg-danger text-white',
  P2: 'bg-warning text-white',
  P3: 'bg-surface-2 text-text-secondary',
};

/**
 * P3 需求分析页主体(对齐原型 P3 帧):
 * 上半「素材分析记录」白卡——灰底批次卡流,点击进入工作台(?run=);
 * 下半「需求产出」——需求块(优先级徽章 + 标题 + 计划/超期徽章)默认展开
 * 需求点行(灰底行卡:状态圆点 + 标题 + 徽章 + 版本 + 详情入口)。
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
  revisionCounts,
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

  // 块级修订历史弹窗(P3j):开关与数据分离,关闭动画期间内容保留
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRequirement, setHistoryRequirement] = useState<RequirementWithOverdue | null>(null);

  const openRevisionHistory = (req: RequirementWithOverdue) => {
    setHistoryRequirement(req);
    setHistoryOpen(true);
  };

  // 需求编辑弹窗(P3i):开关与数据分离,同上
  const [editOpen, setEditOpen] = useState(false);
  const [editRequirement, setEditRequirement] = useState<RequirementWithOverdue | null>(null);

  const openRequirementEdit = (req: RequirementWithOverdue) => {
    setEditRequirement(req);
    setEditOpen(true);
  };

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      {/* 上半:素材分析记录(白卡包裹 + 灰底批次卡流) */}
      <section className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface p-[18px]">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-bold text-text-primary">{t('runsTitle')}</h2>
          <span className="text-[11px] text-text-muted">{t('runsSubtitle')}</span>
          <span className="min-w-0 flex-1" />
          <Link
            href={newAnalysisHref}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[7px] bg-ai px-3 text-xs font-bold text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                href={`${newAnalysisHref}?run=${run.id}`}
                locale={locale}
              />
            ))}
          </div>
        )}
      </section>

      {/* 下半:需求产出(draft 置灰置顶) */}
      <section className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-bold text-text-primary">{t('requirementsTitle')}</h2>
          <span className="text-[11px] text-text-muted">{t('reqsSubtitle')}</span>
        </div>

        {requirements.length === 0 ? (
          <EmptyState
            title={t('reqsEmptyTitle')}
            description={t('reqsEmptyDesc')}
            actionLabel={t('newAnalysis')}
            onAction={() => router.push(newAnalysisHref)}
          />
        ) : (
          <div className="flex flex-col gap-3.5">
            {sortedRequirements.map((req) => (
              <RequirementBlock
                key={req.id}
                requirement={req}
                points={pointsByRequirement.get(req.id) ?? []}
                pointHrefBase={pointHrefBase}
                revisionCount={revisionCounts[req.id] ?? 0}
                pointRevisionCounts={revisionCounts}
                onEvidence={openEvidence}
                onRevisionHistory={openRevisionHistory}
                onEdit={openRequirementEdit}
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

      {/* P3j 块级修订历史弹窗 */}
      <RevisionHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        requirement={historyRequirement}
      />

      {/* P3i 需求编辑弹窗(挂载后 requirement 非空;保存成功后刷新服务端数据) */}
      {editRequirement && (
        <RequirementEditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          requirement={editRequirement}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}

/** 批次卡(原型:灰底描边小卡):素材数徽章 + 状态字 / 标题 / meta / 查看与重跑 */
function RunCard({ run, href, locale }: { run: RunCardData; href: string; locale: string }) {
  const t = useTranslations('browse');

  const statusBadge =
    run.status === 'failed' ? (
      <span className="inline-flex shrink-0 items-center rounded-[4px] bg-danger px-[5px] py-[2px] text-[9px] font-medium leading-none text-white">
        {t('runStatusFailed')}
      </span>
    ) : run.status === 'pending' ? (
      <span className="inline-flex shrink-0 items-center rounded-[4px] bg-surface px-[5px] py-[2px] text-[9px] font-medium leading-none text-warning">
        {t('runStatusPending')}
      </span>
    ) : (
      <span className="inline-flex shrink-0 items-center rounded-[4px] bg-surface px-[5px] py-[2px] text-[9px] font-medium leading-none text-success">
        {t('runStatusDone')}
      </span>
    );

  const meta =
    run.status === 'done'
      ? t('runMetaDone', {
          req: run.draftRequirementCount,
          time: formatShort(run.createdAt, locale),
        })
      : run.status === 'pending'
        ? t('runMetaPending', { time: formatShort(run.createdAt, locale) })
        : t('runMetaFailed');

  const rerunLabel =
    run.status === 'pending'
      ? t('continueAnalysis')
      : run.status === 'failed'
        ? t('retryAnalysis')
        : t('reanalyze');

  return (
    <Link
      href={href}
      className="flex flex-col gap-[7px] rounded-[9px] border border-border bg-bg p-3 transition-colors duration-[120ms] hover:border-accent"
    >
      <div className="flex items-center gap-1.5">
        <span className="inline-flex shrink-0 items-center rounded-[4px] bg-surface-2 px-[5px] py-[2px] text-[9px] leading-none text-text-secondary">
          {t('runMaterials', { count: run.materialCount })}
        </span>
        <span className="min-w-0 flex-1" />
        {statusBadge}
      </div>
      <p className="truncate text-xs font-bold text-text-primary">
        {run.title ?? t('runUntitled')}
      </p>
      <p className="truncate text-[10px] text-text-muted">{meta}</p>
      <div className="flex items-center gap-2 pt-0.5">
        <span className="shrink-0 text-[10px] font-bold text-accent">{t('viewDetail')}</span>
        <span className="min-w-0 flex-1" />
        <span className="shrink-0 text-[10px] text-text-muted">{rerunLabel}</span>
      </div>
    </Link>
  );
}

/**
 * 需求块(原型:白卡;头部 优先级徽章+标题+计划+超期徽+右侧就绪统计),点击折叠。
 * 头部为 div 容器:左侧 button 覆盖原折叠点击区域,右侧 hover 按钮组
 * (✨N 徽标 / 🕘 修订历史,预留 ✏ 编辑入口)不触发折叠(HTML 不允许 button 嵌套)。
 */
function RequirementBlock({
  requirement: req,
  points,
  pointHrefBase,
  revisionCount,
  pointRevisionCounts,
  onEvidence,
  onRevisionHistory,
  onEdit,
}: {
  requirement: RequirementWithOverdue;
  points: RequirementPointRow[];
  pointHrefBase: string;
  /** 块自身修订计数(>0 显示 ✨N) */
  revisionCount: number;
  /** 修订计数映射(透传给点行) */
  pointRevisionCounts: Record<string, number>;
  onEvidence: (point: RequirementPointRow) => void;
  onRevisionHistory: (req: RequirementWithOverdue) => void;
  onEdit: (req: RequirementWithOverdue) => void;
}) {
  const t = useTranslations('browse');
  const locale = useLocale();
  // 原型需求点行直接可见:默认展开,保留点击头部折叠
  const [open, setOpen] = useState(true);
  const isDraft = req.status === 'draft';
  const doneCount = points.filter((p) => p.status === 'done').length;

  return (
    <div
      className={`flex flex-col gap-3 rounded-[10px] border border-border bg-surface p-[18px] transition-colors duration-[120ms] hover:border-accent ${
        isDraft ? 'opacity-75' : ''
      }`}
    >
      <div className="group flex w-full flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? undefined : t('detail')}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5 text-left"
        >
          <span
            className={`inline-flex shrink-0 items-center rounded-[5px] px-[7px] py-[2px] text-[10px] font-bold leading-none ${PRIORITY_BADGE[req.priority]}`}
          >
            {req.priority}
          </span>
          <span className="min-w-0 truncate text-[15px] font-bold text-text-primary">
            {req.title}
          </span>
          <StatusBadge status={req.status} size="sm" />
          {isDraft && <span className="shrink-0 text-[11px] text-draft-gray">{t('draftHint')}</span>}
          <span className="shrink-0 text-[11px] text-text-muted">{planTimeText(req, t, locale)}</span>
          {req.dueSoon && <DueSoonBadge />}
          {req.overdue && <OverdueBadge days={req.overdueDays} />}
          <span className="min-w-0 flex-1" />
          <span className="shrink-0 text-[11px] text-text-muted">
            {t('pointsReady', { done: doneCount, total: points.length })}
          </span>
        </button>
        {/* hover 按钮组:修订徽标 + 历史入口 + 编辑入口 */}
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[120ms] focus-within:opacity-100 group-hover:opacity-100">
          {revisionCount > 0 && (
            <button
              type="button"
              onClick={() => onRevisionHistory(req)}
              className="shrink-0 rounded px-1 py-0.5 text-[10.5px] leading-none text-accent transition-opacity duration-[80ms] hover:opacity-80"
            >
              ✨{revisionCount}
            </button>
          )}
          <button
            type="button"
            onClick={() => onRevisionHistory(req)}
            aria-label={t('revision.historyLabel')}
            className="flex shrink-0 items-center rounded px-1 py-0.5 text-[11px] text-text-secondary transition-all duration-[80ms] hover:text-accent active:scale-[0.97]"
          >
            <ClockIcon className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onEdit(req)}
            aria-label={t('edit.editTrigger')}
            title={t('edit.editTrigger')}
            className="flex shrink-0 items-center rounded px-1 py-0.5 text-[11px] text-text-secondary transition-all duration-[80ms] hover:text-accent active:scale-[0.97]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M14.5 5.5l4 4L8 20H4v-4z" />
              <path d="M12.5 7.5l4 4" />
            </svg>
          </button>
        </span>
      </div>

      {open && points.length > 0 && (
        <ul className="flex flex-col gap-2">
          {points.map((p) => (
            <PointRow
              key={p.id}
              point={p}
              detailHref={`${pointHrefBase}/${p.id}`}
              revisionCount={pointRevisionCounts[p.id] ?? 0}
              onEvidence={() => onEvidence(p)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 需求点行(原型:灰底行卡)状态圆点 + 标题 + 徽章 + AI 徽 + 版本 + 详情入口。
 * 有修订(revisionCount>0)时:版本号旁 ✨N 徽标 + hover 🕘 按钮,点击在行下方
 * 就地下拉展开该点修订历史(P3g),首次展开拉取、切换仅收展不重拉。
 */
function PointRow({
  point,
  detailHref,
  revisionCount,
  onEvidence,
}: {
  point: RequirementPointRow;
  detailHref: string;
  /** 该点修订计数(>0 显示 ✨N 与 🕘 入口) */
  revisionCount: number;
  onEvidence: () => void;
}) {
  const t = useTranslations('browse');
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<RevisionEntry[] | null>(null);
  const [pending, startTransition] = useTransition();

  const hasHistory = revisionCount > 0;

  /** 就地下拉开关:首次展开经 server action 拉取该点修订条目,此后用缓存 */
  const toggleHistory = () => {
    if (!expanded && entries === null) {
      startTransition(async () => {
        setEntries(await getPointRevisionHistory(point.id));
      });
    }
    setExpanded((v) => !v);
  };

  const dotColor =
    point.status === 'done'
      ? 'bg-success'
      : point.status === 'developing'
        ? 'bg-warning'
        : point.status === 'confirmed'
          ? 'bg-accent'
          : 'bg-draft-gray';

  return (
    <li className="group flex flex-col gap-2 rounded-[8px] bg-bg px-3 py-3">
      <div className="flex items-center gap-2.5">
        <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${dotColor}`} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">{point.title}</span>
        <StatusBadge status={point.status} size="sm" />
        {point.origin === 'analysis' && (
          <span className="inline-flex shrink-0 items-center rounded-[4px] bg-surface-2 px-[6px] py-[2px] text-[10px] leading-none text-ai">
            ai:analysis
          </span>
        )}
        {hasHistory && (
          <button
            type="button"
            onClick={toggleHistory}
            className="shrink-0 text-[10.5px] leading-none text-accent transition-opacity duration-[80ms] hover:opacity-80"
          >
            ✨{revisionCount}
          </button>
        )}
        <span className="shrink-0 text-[10px] tabular-nums text-text-muted">v{point.version}</span>
        {hasHistory && (
          <button
            type="button"
            onClick={toggleHistory}
            aria-expanded={expanded}
            aria-label={t('revision.historyLabel')}
            className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] text-text-secondary opacity-0 transition-all duration-[80ms] hover:text-accent focus-within:opacity-100 group-hover:opacity-100 active:scale-[0.97]"
          >
            <ClockIcon className="h-3 w-3" />
            <ChevronIcon className="h-2.5 w-2.5" expanded={expanded} />
          </button>
        )}
        <button
          type="button"
          onClick={onEvidence}
          className="shrink-0 rounded px-1 py-0.5 text-[11px] text-text-secondary transition-all duration-[80ms] hover:text-accent active:scale-[0.97]"
        >
          📄 {t('evidence')}
        </button>
        <Link
          href={detailHref}
          className="shrink-0 rounded px-1 py-0.5 text-[11px] font-bold text-accent transition-opacity hover:opacity-80"
        >
          {t('detail')} ›
        </Link>
      </div>

      {/* P3g 就地修订历史:圆角容器 + 头部 + 条目列表 */}
      {hasHistory && expanded && (
        <div className="flex flex-col gap-[6px] rounded-[10px] bg-surface-2 px-[14px] py-[10px]">
          <div className="flex items-center gap-1.5 text-[12px] font-medium leading-none text-accent">
            <ClockIcon className="h-3 w-3" />
            {t('revision.pointTitle')}
          </div>
          {pending && entries === null ? (
            <p className="px-[10px] py-[7px] text-[11px] text-text-muted">
              {t('revision.loading')}
            </p>
          ) : entries && entries.length > 0 ? (
            entries.map((entry) => (
              <RevisionEntryRow key={entry.id} entry={entry} variant="inline" />
            ))
          ) : (
            <p className="px-[10px] py-[7px] text-[11px] text-text-muted">
              {t('revision.noEntries')}
            </p>
          )}
        </div>
      )}
    </li>
  );
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
