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
import { getPointRevisionHistory, type RevisionEntry } from '@/actions/revisions';
import { deleteRequirementPointAction } from '@/actions/points';
import { showToast } from '@/components/shared/toast';
import { DueSoonBadge, OverdueBadge, StatusBadge } from '@/components/shared/badge';
import { EmptyState } from '@/components/shared/empty-state';
import { BoxIcon, ModuleDeleteDialog, ModuleFormModal } from '@/components/modules/module-dialogs';
import { MergePointsModal } from './merge-points-modal';
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
  /** 失败原因摘要(spec §3.2);null = 旧失败数据,卡面维持现状文案 */
  error: string | null;
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

  // 需求点多选批量操作(spec §9 规则 9b):勾选集合 + 合并/批量删除弹窗
  const [selectedPointIds, setSelectedPointIds] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const togglePointSelect = (id: string) => {
    setSelectedPointIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectedPoints = useMemo(
    () => points.filter((p) => selectedPointIds.includes(p.id)),
    [points, selectedPointIds],
  );

  /** 批量删除:逐点删除(留痕),全部完成或失败即 toast 并清空选择 */
  const bulkDelete = async () => {
    if (bulkDeleting) return;
    setBulkDeleting(true);
    let ok = 0;
    for (const id of selectedPointIds) {
      const res = await deleteRequirementPointAction(id);
      if (res.ok) ok += 1;
    }
    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    showToast(
      ok === selectedPointIds.length
        ? t('bulk.deleted', { count: ok })
        : t('bulk.partialDeleted', { ok, total: selectedPointIds.length }),
      ok === selectedPointIds.length ? undefined : 'error',
    );
    setSelectedPointIds([]);
  };

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
    <div className="flex w-full flex-col gap-6 p-6">
      {/* 上半:素材分析记录(白卡包裹 + 灰底批次卡流) */}
      <section className="flex flex-col gap-3 rounded-[14px] bg-surface p-6">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-bold tracking-tight text-text-primary">
            {t('runsTitle')}
          </h2>
          <span className="text-xs text-text-muted">{t('runsSubtitle')}</span>
          <span className="min-w-0 flex-1" />
          <Link
            href={newAnalysisHref}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-accent px-4 text-xs font-bold text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97]"
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
          <h2 className="text-base font-bold tracking-tight text-text-primary">
            {t('requirementsTitle')}
          </h2>
          <span className="text-xs text-text-muted">{t('reqsSubtitle')}</span>
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
                selectedPointIds={selectedPointIds}
                onTogglePoint={togglePointSelect}
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
                selectedPointIds={selectedPointIds}
                onTogglePoint={togglePointSelect}
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

      {/* P3n 需求点合并弹窗(三栏:清单/参照/编辑;≥2 个点才可打开) */}
      {selectedPoints.length >= 2 && (
        <MergePointsModal
          open={mergeOpen}
          onClose={() => setMergeOpen(false)}
          onMerged={() => setSelectedPointIds([])}
          points={selectedPoints}
          requirements={sortedRequirements.map((r) => ({ id: r.id, title: r.title }))}
        />
      )}

      {/* 批量删除确认弹窗 */}
      {bulkDeleteOpen && (
        <BulkDeleteConfirm
          count={selectedPointIds.length}
          deleting={bulkDeleting}
          onCancel={() => setBulkDeleteOpen(false)}
          onConfirm={bulkDelete}
        />
      )}

      {/* 多选批量浮动条(选中 ≥1 显示;fixed 底部不随滚动丢) */}
      {selectedPointIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-surface px-5 py-2.5 shadow-lg ring-1 ring-border">
          <span className="text-xs font-bold text-text-primary">
            {t('bulk.selected', { count: selectedPointIds.length })}
          </span>
          <span className="h-4 w-px bg-border" />
          <button
            type="button"
            onClick={() => setMergeOpen(true)}
            disabled={selectedPointIds.length < 2}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-accent px-3.5 text-xs font-bold text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            title={selectedPointIds.length < 2 ? t('bulk.mergeMinHint') : undefined}
          >
            ⇉ {t('bulk.merge')}
          </button>
          <button
            type="button"
            onClick={() => setBulkDeleteOpen(true)}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-danger px-3.5 text-xs font-bold text-danger transition-colors duration-[80ms] hover:bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]"
          >
            🗑 {t('bulk.delete')}
          </button>
          <button
            type="button"
            onClick={() => setSelectedPointIds([])}
            className="text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            {t('bulk.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

/** 批量删除确认(轻量 portal 弹窗,危险色主按钮) */
function BulkDeleteConfirm({
  count,
  deleting,
  onCancel,
  onConfirm,
}: {
  count: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('browse.bulk');
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('deleteTitle')}
        className="relative w-[420px] max-w-[92vw] rounded-[12px] bg-surface p-[22px] shadow-xl"
      >
        <h3 className="text-[16px] font-bold tracking-tight text-text-primary">
          {t('deleteTitle')}
        </h3>
        <p className="mt-2 text-sm text-text-secondary">{t('deleteBody', { count })}</p>
        <p className="mt-1 text-xs text-text-muted">{t('deleteHint')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="h-8 rounded-lg border border-border px-3 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="h-8 rounded-full bg-danger px-4 text-xs font-bold text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? t('deleting') : t('confirmDelete')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
      <span className="inline-flex shrink-0 items-center rounded-[4px] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-[5px] py-[2px] text-[9px] font-medium leading-none text-warning">
        {t('runStatusPending')}
      </span>
    ) : (
      <span className="inline-flex shrink-0 items-center rounded-[4px] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] px-[5px] py-[2px] text-[9px] font-medium leading-none text-success">
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
    // 批次卡:白底 hairline 边框嵌入块(原灰底块消灰),hover 描边转蓝
    <Link
      href={href}
      className="flex flex-col gap-[7px] rounded-[9px] border border-border bg-surface p-3 transition-colors duration-[120ms] hover:border-accent"
    >
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[10px] leading-none text-text-muted">
          {t('runMaterials', { count: run.materialCount })}
        </span>
        <span className="min-w-0 flex-1" />
        {statusBadge}
      </div>
      <p className="truncate text-[13px] font-bold text-text-primary">
        {run.title ?? t('runUntitled')}
      </p>
      <p className="truncate text-[11px] text-text-muted">{meta}</p>
      {/* 失败原因摘要:截两行,悬停看全文;旧失败数据无摘要时维持现状 */}
      {run.status === 'failed' && run.error && (
        <p
          className="line-clamp-2 break-all text-[11px] leading-snug text-danger"
          title={run.error}
        >
          {run.error}
        </p>
      )}
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
  selectedPointIds,
  onTogglePoint,
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
  /** 多选批量(spec §9 规则 9b):选中点 id 集与切换回调,透传至点行 checkbox */
  selectedPointIds: string[];
  onTogglePoint: (id: string) => void;
}) {
  const t = useTranslations('browse');
  const locale = useLocale();
  // 原型需求点行直接可见:默认展开,保留点击头部折叠
  const [open, setOpen] = useState(true);
  const isDraft = req.status === 'draft';
  const doneCount = points.filter((p) => p.status === 'done').length;

  return (
    <div
      className={`flex flex-col gap-3 rounded-[14px] bg-surface p-6 transition-shadow duration-[120ms] hover:shadow-sm ${
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
            className={`inline-flex shrink-0 items-center rounded-[5px] px-[8px] py-[3px] text-[11px] font-bold leading-none ${PRIORITY_BADGE[req.priority]}`}
          >
            {req.priority}
          </span>
          <span className="min-w-0 truncate text-[19px] font-bold tracking-tight text-text-primary">
            {req.title}
          </span>
          <StatusBadge status={req.status} size="md" />
          <span className="shrink-0 text-xs text-text-muted">{planTimeText(req, t, locale)}</span>
          {req.dueSoon && <DueSoonBadge />}
          {req.overdue && <OverdueBadge days={req.overdueDays} />}
          <span className="min-w-0 flex-1" />
          <span className="shrink-0 text-xs text-text-muted">
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
        /* 块头与点行区之间的浅分隔:增强「块头 / 点列表」分区感 */
        <ul className="flex flex-col gap-2 border-t border-border pt-3">
          {points.map((p) => (
            <PointRow
              key={p.id}
              point={p}
              detailHref={`${pointHrefBase}/${p.id}`}
              revisionCount={pointRevisionCounts[p.id] ?? 0}
              onEvidence={() => onEvidence(p)}
              checked={selectedPointIds.includes(p.id)}
              onToggle={() => onTogglePoint(p.id)}
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
  checked,
  onToggle,
}: {
  point: RequirementPointRow;
  detailHref: string;
  /** 该点修订计数(>0 显示 ✨N 与 🕘 入口) */
  revisionCount: number;
  onEvidence: () => void;
  /** 多选批量(spec §9 规则 9b):勾选态与切换 */
  checked: boolean;
  onToggle: () => void;
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
    // 需求点行:无底 + hairline 分隔(消整行灰块),hover 极浅反馈;
    // pl-9 相对块头缩进(圆点比 P 徽章右移一档),体现「块 → 点」从属层级;
    // 勾选时整行淡蓝高亮(多选批量,spec §9 规则 9b)
    <li
      className={`group flex flex-col gap-2 rounded-[8px] border-b border-border/70 py-3 pl-9 pr-1 transition-colors duration-[120ms] last:border-0 hover:bg-surface-2/40 ${
        checked ? 'bg-accent-dim' : ''
      }`}
    >
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={t('bulk.checkboxLabel')}
          onClick={onToggle}
          className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-[80ms] ${
            checked ? 'border-accent bg-accent text-white' : 'border-border bg-surface hover:border-accent/60'
          }`}
        >
          {checked && (
            <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
        <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{point.title}</span>
        <StatusBadge status={point.status} size="md" />
        {point.origin === 'analysis' && (
          <span className="inline-flex shrink-0 items-center rounded-[4px] bg-accent-dim px-[6px] py-[2px] text-[10.5px] font-medium leading-none text-accent">
            AI
          </span>
        )}
        {hasHistory && (
          <button
            type="button"
            onClick={toggleHistory}
            className="shrink-0 text-[11.5px] leading-none text-accent transition-opacity duration-[80ms] hover:opacity-80"
          >
            ✨{revisionCount}
          </button>
        )}
        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">v{point.version}</span>
        {hasHistory && (
          <button
            type="button"
            onClick={toggleHistory}
            aria-expanded={expanded}
            aria-label={t('revision.historyLabel')}
            className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-xs text-text-secondary transition-all duration-[80ms] hover:text-accent active:scale-[0.97]"
          >
            <ClockIcon className="h-3 w-3" />
            <ChevronIcon className="h-2.5 w-2.5" expanded={expanded} />
          </button>
        )}
        <button
          type="button"
          onClick={onEvidence}
          className="shrink-0 rounded px-1 py-0.5 text-xs text-text-secondary transition-all duration-[80ms] hover:text-accent active:scale-[0.97]"
        >
          📄 {t('evidence')}
        </button>
        <Link
          href={detailHref}
          className="shrink-0 rounded px-1 py-0.5 text-xs font-bold text-accent transition-opacity hover:opacity-80"
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
  selectedPointIds,
  onTogglePoint,
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
  /** 多选批量(spec §9 规则 9b):选中点 id 集与切换回调,透传至点行 checkbox */
  selectedPointIds: string[];
  onTogglePoint: (id: string) => void;
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
          className={`shrink-0 text-base font-bold ${
            untagged ? 'text-text-secondary' : 'text-text-primary'
          }`}
        >
          {untagged ? tm('untagged') : group.module!.name}
        </span>
        <span className="shrink-0 text-xs leading-none text-text-muted">
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
            selectedPointIds={selectedPointIds}
            onTogglePoint={onTogglePoint}
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
