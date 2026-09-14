'use client';

import type {
  ModuleSummary,
  RequirementPointRow,
  RequirementWithOverdue,
} from '@shipmate/core';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import {
  createModuleAction,
  deleteModuleAction,
  updateModuleAction,
} from '@/actions/modules';
import { getPointRevisionHistory, type RevisionEntry } from '@/actions/revisions';
import { DueSoonBadge, OverdueBadge, StatusBadge } from '@/components/shared/badge';
import { EmptyState } from '@/components/shared/empty-state';
import { showToast } from '@/components/shared/toast';
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

/** spec §14:弹窗开关动画 120ms(与 shared/modal 一致) */
const ANIM_MS = 120;

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
  /** 模块列表(core.modules.listModules,组序已按 sortOrder→name);空数组 = 项目未建模块,需求区维持平铺 */
  modules: ModuleSummary[];
  /** materialId → 素材标题(P3b 依据弹窗展示用) */
  materialTitles: Record<string, string>;
  /** 修订计数(键为 requirementId / pointId)——✨N 徽标用,0 视为无修订 */
  revisionCounts: Record<string, number>;
}

/** 模块组数据:module 为 null 表示「未归类」组(永远置底) */
interface ModuleGroupData {
  module: ModuleSummary | null;
  /** 组内需求块(沿用整体排序:优先级 → 截止时间) */
  reqs: RequirementWithOverdue[];
  count: number;
  pointsDone: number;
  pointsTotal: number;
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
  modules,
  materialTitles,
  revisionCounts,
}: AnalysisBrowseProps) {
  const t = useTranslations('browse');
  const tm = useTranslations('browse.modules');
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

  // 模块分组(P3k):组序 = modules 顺序(listModules 已按 sortOrder→name),未归类组置底;
  // 统计从页面数据本地聚合,保证与展示一致。无模块时返回 null → 维持平铺(spec §14 空态)。
  const moduleGroups = useMemo<ModuleGroupData[] | null>(() => {
    if (modules.length === 0) return null;
    const stats = new Map<string, Omit<ModuleGroupData, 'module' | 'reqs'>>();
    for (const m of modules) stats.set(m.id, { count: 0, pointsDone: 0, pointsTotal: 0 });
    const reqsByModule = new Map<string, RequirementWithOverdue[]>();
    const untagged: RequirementWithOverdue[] = [];
    let untaggedDone = 0;
    let untaggedTotal = 0;
    for (const req of sortedRequirements) {
      const stat = req.moduleId ? stats.get(req.moduleId) : undefined;
      if (!stat) {
        // 未挂模块(或模块刚删除而列表未刷新的数据竞态兜底)→ 未归类
        untagged.push(req);
        const ps = pointsByRequirement.get(req.id);
        if (ps) {
          untaggedTotal += ps.length;
          untaggedDone += ps.filter((p) => p.status === 'done').length;
        }
        continue;
      }
      stat.count += 1;
      const ps = pointsByRequirement.get(req.id);
      if (ps) {
        stat.pointsTotal += ps.length;
        stat.pointsDone += ps.filter((p) => p.status === 'done').length;
      }
      const list = reqsByModule.get(req.moduleId!);
      if (list) list.push(req);
      else reqsByModule.set(req.moduleId!, [req]);
    }
    const groups: ModuleGroupData[] = modules.map((m) => ({
      module: m,
      reqs: reqsByModule.get(m.id) ?? [],
      ...stats.get(m.id)!,
    }));
    // 未归类组:有需求才渲染,永远置底
    if (untagged.length === 0) return groups;
    return [
      ...groups,
      {
        module: null,
        reqs: untagged,
        count: untagged.length,
        pointsDone: untaggedDone,
        pointsTotal: untaggedTotal,
      },
    ];
  }, [modules, sortedRequirements, pointsByRequirement]);

  // 弹窗数据与开关分离(与 evidence/history/edit 同模式):关闭只切 open,动画期间内容不闪空
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

  // 模块新建/重命名表单弹窗(P3k):数据与开关分离,同上
  const [moduleForm, setModuleForm] = useState<{
    mode: 'create' | 'rename';
    module: ModuleSummary | null;
  } | null>(null);
  const [moduleFormOpen, setModuleFormOpen] = useState(false);

  // 模块删除确认弹窗:数据与开关分离,同上
  const [moduleDelete, setModuleDelete] = useState<ModuleSummary | null>(null);
  const [moduleDeleteOpen, setModuleDeleteOpen] = useState(false);

  const openModuleCreate = () => {
    setModuleForm({ mode: 'create', module: null });
    setModuleFormOpen(true);
  };

  const openModuleRename = (m: ModuleSummary) => {
    setModuleForm({ mode: 'rename', module: m });
    setModuleFormOpen(true);
  };

  const openModuleDelete = (m: ModuleSummary) => {
    setModuleDelete(m);
    setModuleDeleteOpen(true);
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

      {/* 下半:需求产出(draft 置灰置顶;有模块时按模块分组,未归类置底) */}
      <section className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-bold text-text-primary">{t('requirementsTitle')}</h2>
          <span className="text-[11px] text-text-muted">{t('reqsSubtitle')}</span>
          <span className="min-w-0 flex-1" />
          {/* P3k:section 行右侧「+ 新建模块」幽灵按钮 */}
          <button
            type="button"
            onClick={openModuleCreate}
            className="inline-flex shrink-0 items-center gap-1 rounded-[6px] border border-border bg-surface px-[10px] py-[4px] text-[11px] font-medium text-text-secondary transition-colors duration-[120ms] hover:border-accent hover:text-accent"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {tm('createModule')}
          </button>
        </div>

        {requirements.length === 0 ? (
          <EmptyState
            title={t('reqsEmptyTitle')}
            description={t('reqsEmptyDesc')}
            actionLabel={t('newAnalysis')}
            onAction={() => router.push(newAnalysisHref)}
          />
        ) : moduleGroups ? (
          /* 模块分组视图:组间 gap-5、组内块间 gap-2.5(组内复用现有 RequirementBlock) */
          <div className="flex flex-col gap-5">
            {moduleGroups.map((group) => (
              <ModuleGroup
                key={group.module?.id ?? 'untagged'}
                group={group}
                pointHrefBase={pointHrefBase}
                revisionCounts={revisionCounts}
                pointsByRequirement={pointsByRequirement}
                onEvidence={openEvidence}
                onRevisionHistory={openRevisionHistory}
                onEdit={openRequirementEdit}
                onRename={openModuleRename}
                onDelete={openModuleDelete}
              />
            ))}
          </div>
        ) : (
          /* 无模块空态:维持现状平铺,不显示组头 */
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
          modules={modules}
          onSaved={() => router.refresh()}
        />
      )}

      {/* P3k 模块新建/重命名弹窗(挂载后 moduleForm 非空;保存成功后刷新服务端数据) */}
      {moduleForm && (
        <ModuleFormModal
          projectId={projectId}
          mode={moduleForm.mode}
          module={moduleForm.module}
          open={moduleFormOpen}
          onClose={() => setModuleFormOpen(false)}
          onSaved={() => {
            setModuleFormOpen(false);
            router.refresh();
          }}
        />
      )}

      {/* P3k 模块删除确认弹窗(危险确认简化版) */}
      {moduleDelete && (
        <ModuleDeleteDialog
          module={moduleDelete}
          open={moduleDeleteOpen}
          onClose={() => setModuleDeleteOpen(false)}
          onSaved={() => {
            setModuleDeleteOpen(false);
            router.refresh();
          }}
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
        {/* 按钮组常显:hover 显隐可发现性差(仅头部行触发,卡内其余区域无反馈) */}
        <span className="flex shrink-0 items-center gap-0.5">
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
            className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] text-text-secondary transition-all duration-[80ms] hover:text-accent active:scale-[0.97]"
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

/** box 图标(自绘 12px 立方体,随 currentColor 着色):模块组头与模块弹窗共用 */
function BoxIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </svg>
  );
}

/**
 * 模块组(原型 P3k):组头(box 图标 + 名称 + 统计徽章 + 折叠圆钮 + ⋯ 菜单)
 * + 组内需求块流(复用现有 RequirementBlock,沿用整体排序:优先级 → 截止时间)。
 * 折叠只收组内块,组头常驻;「未归类」组图标与文字用弱化配色。
 */
function ModuleGroup({
  group,
  pointHrefBase,
  revisionCounts,
  pointsByRequirement,
  onEvidence,
  onRevisionHistory,
  onEdit,
  onRename,
  onDelete,
}: {
  group: ModuleGroupData;
  pointHrefBase: string;
  /** 修订计数映射(透传给块) */
  revisionCounts: Record<string, number>;
  pointsByRequirement: Map<string, RequirementPointRow[]>;
  onEvidence: (point: RequirementPointRow) => void;
  onRevisionHistory: (req: RequirementWithOverdue) => void;
  onEdit: (req: RequirementWithOverdue) => void;
  onRename: (module: ModuleSummary) => void;
  onDelete: (module: ModuleSummary) => void;
}) {
  const tm = useTranslations('browse.modules');
  // 组头折叠只收组内块:默认展开(与需求块折叠一致)
  const [open, setOpen] = useState(true);
  const untagged = group.module === null;

  return (
    <div className="flex flex-col gap-2.5">
      {/* 组头:图标块 + 名称 + 统计徽章 + 折叠圆钮 + ⋯ 菜单 */}
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] ${
            untagged ? 'bg-surface-2 text-text-muted' : 'bg-accent-dim text-accent'
          }`}
          aria-hidden
        >
          <BoxIcon />
        </span>
        <span
          className={`shrink-0 text-[14px] font-bold ${
            untagged ? 'text-text-secondary' : 'text-text-primary'
          }`}
        >
          {untagged ? tm('untagged') : group.module!.name}
        </span>
        <span className="inline-flex shrink-0 items-center rounded-[5px] bg-surface-2 px-[8px] py-[3px] text-[10.5px] leading-none text-text-secondary">
          {tm('count', { count: group.count, done: group.pointsDone, total: group.pointsTotal })}
        </span>
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={tm('toggle')}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-secondary transition-colors duration-[120ms] hover:text-text-primary"
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-3 w-3 transition-transform duration-[120ms] ${open ? '' : '-rotate-90'}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {group.module && (
          <ModuleMenu
            module={group.module}
            onRename={() => onRename(group.module!)}
            onDelete={() => onDelete(group.module!)}
          />
        )}
      </div>

      {/* 组内需求块:复用现有卡(✨N/🕘/✏/📄/详情等入口都在块内原位保留) */}
      {open &&
        group.reqs.map((req) => (
          <RequirementBlock
            key={req.id}
            requirement={req}
            points={pointsByRequirement.get(req.id) ?? []}
            pointHrefBase={pointHrefBase}
            revisionCount={revisionCounts[req.id] ?? 0}
            pointRevisionCounts={revisionCounts}
            onEvidence={onEvidence}
            onRevisionHistory={onRevisionHistory}
            onEdit={onEdit}
          />
        ))}
    </div>
  );
}

/**
 * 模块 ⋯ 菜单(重命名 / 删除),参照 ProjectDeleteMenu 的下拉模式:
 * 点外与 Escape 关闭;选中项只回调,弹窗开关由父级管理。
 */
function ModuleMenu({
  module,
  onRename,
  onDelete,
}: {
  module: ModuleSummary;
  onRename: () => void;
  onDelete: () => void;
}) {
  const tm = useTranslations('browse.modules');
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={tm('menu')}
        className={`flex h-5 w-5 items-center justify-center rounded text-[13px] leading-none text-text-muted transition-colors duration-[120ms] hover:bg-surface-2 hover:text-text-primary ${
          menuOpen ? 'bg-surface-2 text-text-primary' : ''
        }`}
      >
        ⋯
      </button>
      {menuOpen && (
        <span
          role="menu"
          className="dropdown-enter absolute right-0 top-[calc(100%+4px)] z-10 flex w-36 flex-col overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onRename();
            }}
            className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-2"
          >
            ✏ {tm('renameModule')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
            className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-left text-[13px] text-danger transition-colors hover:bg-danger/10"
          >
            🗑 {tm('deleteModule')}
          </button>
        </span>
      )}
    </span>
  );
}

/** 文件内轻量弹窗壳:与 RequirementEditModal 同族(portal + 120ms 开关动画 + Escape/遮罩关闭) */
function ModalShell({
  open,
  onClose,
  label,
  width,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  /** 弹窗宽度类,如 max-w-[440px] */
  width: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  // 开关动画时序与 RequirementEditModal 一致:mounted 控制渲染,双 rAF 保证过渡生效
  useEffect(() => {
    if (!open) {
      setShown(false);
      const timer = setTimeout(() => setMounted(false), ANIM_MS);
      return () => clearTimeout(timer);
    }
    setMounted(true);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-[120ms] ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`relative flex max-h-[85vh] w-full ${width} flex-col rounded-[12px] bg-surface p-[22px] shadow-xl transition-all duration-[120ms] ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        }`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 模块新建 / 重命名弹窗(轻量:名称必填 + 新建时描述可选;重命名只改名单)。
 * MODULE_NAME_TAKEN 在表单内联展示「模块名已存在」,其余错误走 toast。
 */
function ModuleFormModal({
  projectId,
  mode,
  module,
  open,
  onClose,
  onSaved,
}: {
  projectId: string;
  mode: 'create' | 'rename';
  module: ModuleSummary | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tm = useTranslations('browse.modules');
  const ts = useTranslations('shared');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 每次打开重置(组件因「数据与开关分离」不随关闭卸载,与 RequirementEditModal 同理)
  useEffect(() => {
    if (open) {
      setName(mode === 'rename' ? (module?.name ?? '') : '');
      setDescription('');
      setError(null);
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 名称必填非空,空值禁用提交
  const canSubmit = name.trim().length > 0 && !saving;
  const title = tm(mode === 'create' ? 'createTitle' : 'renameTitle');

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const res =
      mode === 'create'
        ? await createModuleAction({
            projectId,
            name: name.trim(),
            description: description.trim() || undefined,
          })
        : await updateModuleAction(module!.id, { name: name.trim() });
    setSaving(false);
    if (res.ok) {
      showToast(mode === 'create' ? tm('created') : tm('renamed'), 'success');
      onSaved();
    } else if (res.code === 'MODULE_NAME_TAKEN') {
      setError(tm('exists'));
    } else {
      showToast(res.message, 'error');
    }
  };

  return (
    <ModalShell open={open} onClose={onClose} label={title} width="max-w-[440px]">
      {/* 头部:box 图标块 + 标题 + 圆形关闭钮 */}
      <div className="flex shrink-0 items-center gap-2.5">
        <span
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-accent-dim text-accent"
          aria-hidden
        >
          <BoxIcon />
        </span>
        <h2 className="min-w-0 flex-1 text-base font-bold text-text-primary">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={ts('close')}
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] text-text-secondary transition-colors duration-[120ms] hover:text-text-primary"
        >
          ✕
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pt-3.5">
        {/* 名称(必填) */}
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-text-muted">{tm('groupName')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder={tm('groupNamePh')}
            autoFocus
            className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors duration-[120ms] placeholder:text-text-muted focus:border-accent"
          />
        </label>

        {/* 描述(仅新建提供,可选) */}
        {mode === 'create' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-text-muted">{tm('groupDesc')}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={tm('groupDescPh')}
              className="w-full resize-none rounded-lg border border-border bg-bg px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors duration-[120ms] placeholder:text-text-muted focus:border-accent"
            />
          </label>
        )}

        {/* 重名内联错误(MODULE_NAME_TAKEN) */}
        {error && <p className="text-[11.5px] text-danger">{error}</p>}
      </div>

      {/* 底部操作:右对齐 取消 / 提交 */}
      <div className="flex shrink-0 items-center justify-end gap-2.5 pt-3.5">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-lg bg-surface-2 px-4 py-[9px] text-[13px] text-text-secondary transition-colors duration-[120ms] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {tm('cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-lg bg-accent px-4 py-[9px] text-[13px] font-bold text-white transition-opacity duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? tm(mode === 'create' ? 'creating' : 'saving') : tm(mode === 'create' ? 'create' : 'save')}
        </button>
      </div>
    </ModalShell>
  );
}

/**
 * 模块删除确认弹窗(delete-project-dialog 的危险确认简化版):
 * 红系头部 + 警示条(模块名 + N 个需求转未归类)+ 取消 / 删除;不做输入确认。
 */
function ModuleDeleteDialog({
  module,
  open,
  onClose,
  onSaved,
}: {
  module: ModuleSummary;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tm = useTranslations('browse.modules');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) setPending(false);
  }, [open]);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    const res = await deleteModuleAction(module.id);
    setPending(false);
    if (res.ok) {
      showToast(tm('deleted', { name: module.name, count: module.requirementCount }), 'success');
      onSaved();
    } else {
      showToast(res.message, 'error');
    }
  };

  return (
    <ModalShell open={open} onClose={onClose} label={tm('deleteTitle')} width="max-w-[440px]">
      {/* 红系头部:危险图标 + 标题/模块名 */}
      <div className="flex shrink-0 items-center gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-danger/10 text-[17px]"
          aria-hidden
        >
          🗑
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-base font-semibold leading-tight text-danger">
            {tm('deleteTitle')}
          </span>
          <span className="truncate text-xs leading-tight text-text-secondary">{module.name}</span>
        </span>
      </div>

      {/* 红色警示条:模块下 N 个需求将转为未归类 */}
      <div className="mt-3.5 shrink-0 rounded-[10px] bg-danger/[0.08] p-3 outline outline-1 -outline-offset-1 outline-danger/30">
        <p className="text-[13px] leading-snug text-danger">
          {tm('deleteConfirm', { name: module.name, count: module.requirementCount })}
        </p>
      </div>

      {/* 底部操作:右对齐 取消 / 删除 */}
      <div className="flex shrink-0 items-center justify-end gap-2.5 pt-4">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="rounded-lg bg-surface-2 px-4 py-[9px] text-[13px] text-text-secondary transition-colors duration-[120ms] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {tm('cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-danger px-4 py-[9px] text-[13px] font-bold text-white transition-opacity duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? tm('deleting') : tm('deleteModule')}
        </button>
      </div>
    </ModalShell>
  );
}
