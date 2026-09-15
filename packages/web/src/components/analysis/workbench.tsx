'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalysisResult, AnalysisRunDetail, MaterialRow, ModuleRow, ModuleSummary } from '@shipmate/core';
import {
  addMaterialAction,
  applyAnalysisRunAction,
  createAnalysisRunAction,
  getAnalysisRun,
  saveAnalysisDraftAction,
  startAnalysisAction,
  updateMaterialAction,
} from '@/actions/analysis';
import { createModuleAction, listModulesAction } from '@/actions/modules';
import { Modal } from '@/components/shared/modal';
import { showToast } from '@/components/shared/toast';
import {
  toPointState,
  type DraftBlockState,
  type ExistingRequirementView,
  type SupplementBlockState,
} from '@/components/analysis/draft-block';
import { MaterialPanel } from '@/components/analysis/material-panel';
import { DraftPanel } from '@/components/analysis/draft-panel';
import { ReviseModal, type ReviseTarget } from '@/components/analysis/revise-modal';

type RunStatus = 'pending' | 'done' | 'failed';

/** 草稿块本地 key 自增(草稿无 id,进程内唯一即可;仅用于 React 复用) */
let blockKeySeq = 0;
function nextBlockKey(prefix: string): string {
  return `${prefix}-${++blockKeySeq}`;
}

/** 结果卡 stagger 淡入(spec §14:每条间隔 40ms;backwards 保证延迟期间不可见) */
const WORKBENCH_CSS = `
@keyframes analysis-enter {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.analysis-enter {
  animation: analysis-enter 180ms cubic-bezier(0.2, 0, 0, 1) backwards;
}
`;

/** 修订弹窗关闭期间的占位块(ReviseModal 常驻挂载以播退出动画,open=false 不渲染内容) */
const CLOSED_BLOCK: DraftBlockState = {
  key: 'revise-closed',
  selected: true,
  title: '',
  summary: '',
  module: '',
  conflict: null,
  resolution: null,
  points: [],
  revisions: [],
};

/**
 * Run 暂存草稿(unknown jsonb)→ AnalysisResult。
 * client 侧不能 import core 运行时值(会把 pg 拖进浏览器 bundle),
 * 故手写轻量防御;严格 zod 校验在 saveAnalysisDraftAction 落库前完成。
 */
function toDraft(raw: unknown): AnalysisResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as AnalysisResult;
  return Array.isArray(d.requirements) && Array.isArray(d.supplements) ? d : null;
}

function blocksFromDraft(draft: AnalysisResult): DraftBlockState[] {
  return draft.requirements.map((r) => ({
    key: nextBlockKey('b'),
    selected: true,
    title: r.title,
    summary: r.summary ?? '',
    // AI 归类建议(spec §9 规则 10);旧草稿无该字段,兜底空串 = 未归类
    module: r.module ?? '',
    conflict: r.conflict
      ? {
          type: r.conflict.type,
          targetTitle: r.conflict.target_requirement_title,
          reason: r.conflict.reason ?? '',
        }
      : null,
    resolution: r.conflict?.type === 'duplicate' ? ('merge' as const) : null,
    points: r.points.map((p) =>
      toPointState({
        title: p.title,
        description: p.description,
        confidence: p.confidence,
        evidences: p.evidences,
      }),
    ),
    // 块级修订记录(spec §9 规则 9)随草稿带出,写回时原样保留
    revisions: r.revisions ?? [],
  }));
}

function suppsFromDraft(draft: AnalysisResult): SupplementBlockState[] {
  return draft.supplements.map((s) => ({
    key: nextBlockKey('s'),
    selected: true,
    targetTitle: s.target_requirement_title,
    points: s.points.map((p) =>
      toPointState({
        title: p.title,
        description: p.description,
        confidence: p.confidence,
        evidences: p.evidences,
      }),
    ),
  }));
}

/** 批次状态徽章(pending=muted / done=success / failed=danger) */
function RunStatusBadge({ status }: { status: RunStatus }) {
  const t = useTranslations('analysis');
  const cls =
    status === 'done'
      ? 'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success'
      : status === 'failed'
        ? 'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger'
        : 'bg-[color-mix(in_srgb,var(--text-muted)_12%,transparent)] text-text-muted';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {t(`batch.${status}`)}
    </span>
  );
}

/**
 * UI 编辑后的完整草稿(「应用」/「AI 修订应用」前整体写回 Run 暂存,apply 按 title 定位)。
 * 纯函数:AI 修订应用需要基于「下一帧」的 blocks 先落库再 setState,避免读到旧状态。
 * 块级 revisions 原样带回,保证修订链(spec §9 规则 9)不因草稿写回而丢失。
 */
function buildDraftPayload(
  blocks: DraftBlockState[],
  supps: SupplementBlockState[],
): AnalysisResult {
  return {
    requirements: blocks.map((b) => ({
      title: b.title.trim(),
      summary: b.summary.trim(),
      // 块级归类建议随草稿带出(spec §9 规则 10),apply 按名落模块
      module: b.module,
      conflict: b.conflict
        ? {
            type: b.conflict.type,
            target_requirement_title: b.conflict.targetTitle,
            reason: b.conflict.reason,
          }
        : undefined,
      points: b.points.map((p) => ({
        title: p.title.trim(),
        description: p.description,
        confidence: p.confidence,
        evidences: p.evidences,
      })),
      ...(b.revisions.length > 0 ? { revisions: b.revisions } : {}),
    })),
    supplements: supps.map((s) => ({
      target_requirement_title: s.targetTitle,
      points: s.points.map((p) => ({
        title: p.title.trim(),
        description: p.description,
        confidence: p.confidence,
        evidences: p.evidences,
      })),
    })),
  };
}

/**
 * P3c 素材分析工作台状态中枢。
 * 页面加载时可带已有批次(run),也可从零开始(首次添加素材时才创建批次,
 * 避免空批次垃圾数据);「应用」前把编辑后的完整草稿写回 Run,再走 core
 * applyAnalysisRun(勾选 + duplicate/contradiction 裁决)落库。
 */
export function AnalysisWorkbench({
  projectId,
  run,
  existingRequirements,
}: {
  projectId: string;
  run: AnalysisRunDetail | null;
  existingRequirements: ExistingRequirementView[];
}) {
  const t = useTranslations('analysis');
  const router = useRouter();

  const [runId, setRunId] = useState<string | null>(run?.run.id ?? null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(run?.run.status ?? null);
  // 失败原因摘要(spec §3.2 run.error):旧失败数据为 null 时横幅维持现状文案
  const [runError, setRunError] = useState<string | null>(run?.run.error ?? null);
  const [materials, setMaterials] = useState<MaterialRow[]>(run?.materials ?? []);
  const [blocks, setBlocks] = useState<DraftBlockState[]>(() => {
    const draft = run ? toDraft(run.run.draftResult) : null;
    return draft ? blocksFromDraft(draft) : [];
  });
  const [supps, setSupps] = useState<SupplementBlockState[]>(() => {
    const draft = run ? toDraft(run.run.draftResult) : null;
    return draft ? suppsFromDraft(draft) : [];
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** 项目模块列表(归类下拉选项);进工作台拉一次,新建后本地追加 */
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  /** materialId → 素材标题(块/点源头素材展示) */
  const materialTitles = useMemo(
    () => Object.fromEntries(materials.map((m) => [m.id, m.title ?? ''])),
    [materials],
  );
  /** AI 修订弹窗目标(null = 关闭);blockIndex 定位本地块,pointIndex null = 整块 */
  const [reviseTarget, setReviseTarget] = useState<ReviseTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    listModulesAction(projectId)
      .then((rows) => {
        if (!cancelled) setModules(rows);
      })
      .catch(() => {
        /* 列表拉取失败不阻塞工作台,归类下拉仅缺选项 */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /** 归类下拉内新建模块:成功后本地追加列表并返回新行(选中),失败 toast 返回 null */
  const handleCreateModule = useCallback(
    async (name: string): Promise<ModuleRow | null> => {
      const res = await createModuleAction({ projectId, name });
      if (!res.ok) {
        showToast(res.message, 'error');
        return null;
      }
      // ModuleRow 无统计字段,新模块尚无需求,本地补零对齐 ModuleSummary
      const summary: ModuleSummary = { ...res.data, requirementCount: 0, pointsDone: 0, pointsTotal: 0 };
      setModules((prev) => [...prev, summary]);
      return res.data;
    },
    [projectId],
  );

  const existingByTitle = useMemo(
    () => new Map(existingRequirements.map((r) => [r.title, r])),
    [existingRequirements],
  );

  const selectedBlocks = useMemo(() => blocks.filter((b) => b.selected), [blocks]);
  const selectedSupps = useMemo(() => supps.filter((s) => s.selected), [supps]);
  const hasDraft = blocks.length > 0 || supps.length > 0;
  const unresolvedCount = blocks.filter(
    (b) => b.selected && b.conflict?.type === 'contradiction' && !b.resolution,
  ).length;
  const applyDisabled =
    !hasDraft ||
    analyzing ||
    applying ||
    unresolvedCount > 0 ||
    (selectedBlocks.length === 0 && selectedSupps.length === 0);

  /** 新批次延迟到首次写操作(添加素材/开始分析)时创建,避免空批次 */
  const ensureRun = useCallback(async (): Promise<string | null> => {
    if (runId) return runId;
    const res = await createAnalysisRunAction({ projectId });
    if (!res.ok) {
      showToast(res.message, 'error');
      return null;
    }
    setRunId(res.data.id);
    setRunStatus(res.data.status);
    return res.data.id;
  }, [runId, projectId]);

  const handleAddMaterial = useCallback(
    async (input: {
      type: MaterialRow['type'];
      title: string;
      rawContent: string;
    }): Promise<boolean> => {
      const id = await ensureRun();
      if (!id) return false;
      const res = await addMaterialAction({
        runId: id,
        type: input.type,
        title: input.title || undefined,
        rawContent: input.rawContent,
      });
      if (!res.ok) {
        showToast(res.message, 'error');
        return false;
      }
      setMaterials((prev) => [...prev, res.data]);
      showToast(t('materialAdded'));
      return true;
    },
    [ensureRun, t],
  );

  /** 编辑素材(spec §3.3):成功后本地替换该行;失败 toast 并保持卡片编辑态 */
  const handleUpdateMaterial = useCallback(
    async (
      id: string,
      input: { title: string; rawContent: string },
    ): Promise<boolean> => {
      const res = await updateMaterialAction(id, input);
      if (!res.ok) {
        showToast(res.message, 'error');
        return false;
      }
      setMaterials((prev) => prev.map((m) => (m.id === id ? res.data : m)));
      showToast(t('materialUpdated'));
      return true;
    },
    [t],
  );

  const handleStart = useCallback(async () => {
    if (analyzing || materials.length === 0) return;
    setAnalyzing(true);
    try {
      const id = await ensureRun();
      if (!id) return;
      const res = await startAnalysisAction(id);
      if (!res.ok) {
        // LLM 未配置为 VALIDATION_ERROR,中文 message 直接 toast;LLM 类错误同时置批次失败态
        if (res.code === 'LLM_ERROR' || res.code === 'LLM_SCHEMA_MISMATCH') {
          setRunStatus('failed');
          // 失败摘要已由 core 落库(spec §3.2),重新拉取供失败横幅展示诊断
          const detail = await getAnalysisRun(id).catch(() => null);
          if (detail) setRunError(detail.run.error);
        }
        showToast(res.message, 'error');
        return;
      }
      setRunStatus(res.data.status);
      // 重新分析成功时 core 已置 error=null,本地同步清掉旧失败摘要
      setRunError(res.data.error ?? null);
      const draft = toDraft(res.data.draftResult);
      if (draft) {
        setBlocks(blocksFromDraft(draft));
        setSupps(suppsFromDraft(draft));
      }
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, materials.length, ensureRun]);

  const handleConfirmApply = useCallback(async () => {
    setConfirmOpen(false);
    if (applying || !runId) return;
    if (selectedBlocks.length === 0 && selectedSupps.length === 0) {
      showToast(t('applyNothing'), 'error');
      return;
    }
    // 勾选项以 title 定位落库,空标题直接拦截
    const invalidBlock = selectedBlocks.find(
      (b) => !b.title.trim() || b.points.some((p) => !p.title.trim()),
    );
    const invalidSupp = selectedSupps.find((s) => s.points.some((p) => !p.title.trim()));
    if (invalidBlock || invalidSupp) {
      showToast(t('applyInvalidTitle'), 'error');
      return;
    }

    setApplying(true);
    try {
      const save = await saveAnalysisDraftAction(runId, buildDraftPayload(blocks, supps));
      if (!save.ok) {
        showToast(save.message, 'error');
        return;
      }
      // duplicate 默认 merge(core 兜底一致),用户显式选择才传;contradiction 必已裁决(按钮禁用保证)
      const decisions = selectedBlocks.flatMap((b) =>
        b.resolution ? [{ requirementTitle: b.title.trim(), resolution: b.resolution }] : [],
      );
      const res = await applyAnalysisRunAction(runId, {
        selectedRequirements: selectedBlocks.map((b) => b.title.trim()),
        selectedSupplements: selectedSupps.map((s) => s.targetTitle),
        decisions,
      });
      if (!res.ok) {
        showToast(res.message, 'error');
        return;
      }
      showToast(t('applied', { count: res.data.length }));
      router.push(`/project/${projectId}/analysis`);
    } finally {
      setApplying(false);
    }
  }, [applying, runId, blocks, supps, selectedBlocks, selectedSupps, router, projectId, t]);

  /** 打开 AI 修订弹窗;无批次(草稿未落库)时无法调 core reviseDraft,直接提示 */
  const openRevise = useCallback(
    (blockIndex: number, pointIndex: number | null) => {
      if (!runId) {
        showToast(t('revise.noRun'), 'error');
        return;
      }
      setReviseTarget({ blockIndex, pointIndex });
    },
    [runId, t],
  );

  /**
   * AI 修订「应用」:把修订后的块写进本地草稿并整体写回 Run(saveAnalysisDraft,
   * 修订链 revisions 随载荷保留),成功后 toast + 关弹窗;失败保持弹窗打开。
   * 用 nextBlocks 先落库再 setState,避免闭包读到旧 blocks。
   */
  const handleReviseApplied = useCallback(
    async (blockIndex: number, nextBlock: DraftBlockState): Promise<boolean> => {
      if (!runId) return false;
      const nextBlocks = blocks.map((b, i) => (i === blockIndex ? nextBlock : b));
      const save = await saveAnalysisDraftAction(runId, buildDraftPayload(nextBlocks, supps));
      if (!save.ok) {
        showToast(save.message, 'error');
        return false;
      }
      setBlocks(nextBlocks);
      showToast(t('revise.applied'));
      setReviseTarget(null);
      return true;
    },
    [runId, blocks, supps, t],
  );

  const reviseBlock = reviseTarget ? blocks[reviseTarget.blockIndex] : undefined;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <style>{WORKBENCH_CSS}</style>

      <header className="flex shrink-0 items-center gap-3">
        <Link
          href={`/project/${projectId}/analysis`}
          className="inline-flex shrink-0 items-center gap-1 text-sm text-text-secondary transition-colors hover:text-accent"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
          {t('back')}
        </Link>
        <h1 className="text-lg font-semibold text-text-primary">{t('title')}</h1>
        {runStatus && <RunStatusBadge status={runStatus} />}
        {run?.run.title && (
          <span className="min-w-0 truncate text-xs text-text-muted">{run.run.title}</span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <MaterialPanel
          materials={materials}
          runStatus={runStatus}
          runError={runError}
          analyzing={analyzing}
          onStart={handleStart}
          onAdd={handleAddMaterial}
          onUpdate={handleUpdateMaterial}
        />
        <DraftPanel
          blocks={blocks}
          supps={supps}
          existingByTitle={existingByTitle}
          modules={modules}
          onCreateModule={handleCreateModule}
          materialTitles={materialTitles}
          analyzing={analyzing}
          applying={applying}
          applyDisabled={applyDisabled}
          unresolvedCount={unresolvedCount}
          onBlocksChange={setBlocks}
          onSuppsChange={setSupps}
          onApply={() => setConfirmOpen(true)}
          onRevise={openRevise}
        />
      </div>

      <ReviseModal
        open={!!reviseTarget && !!reviseBlock}
        runId={runId}
        target={reviseTarget ?? { blockIndex: 0, pointIndex: null }}
        block={reviseBlock ?? CLOSED_BLOCK}
        onClose={() => setReviseTarget(null)}
        onApplied={handleReviseApplied}
      />

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('applyConfirmTitle')}
      >
        <p className="text-sm text-text-secondary">{t('applyConfirmBody')}</p>
        <p className="mt-2 text-xs text-text-muted">
          {t('applyConfirmStat', {
            requirements: selectedBlocks.length,
            supplements: selectedSupps.length,
          })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="h-8 rounded-md border border-border px-3 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirmApply}
            disabled={applying}
            className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
          >
            {applying ? t('applying') : t('confirmApply')}
          </button>
        </div>
      </Modal>
    </div>
  );
}
