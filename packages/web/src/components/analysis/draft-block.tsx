'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type {
  ConflictResolution,
  ModuleRow,
  ModuleSummary,
  RequirementPointRow,
  RequirementRow,
} from '@shipmate/core';
import { StatusBadge } from '@/components/shared/badge';

/**
 * P3c 草稿块的本地编辑态类型与渲染。
 * 草稿未落库无 id,本地 key 仅用于 React 复用与块内定位;
 * 「应用」时整体写回 Run 草稿(saveAnalysisDraftAction),再按 title 定位走
 * core applyAnalysisRun(勾选 + 冲突裁决),见 workbench.tsx。
 */

export type ConflictType = 'duplicate' | 'contradiction';

/** UI 可选的裁决值:core ConflictResolution 去掉仅服务端语义的 skip */
export type BlockResolution = Extract<
  ConflictResolution,
  'merge' | 'create_anyway' | 'use_new' | 'use_old' | 'keep_both'
>;

export interface ConflictView {
  type: ConflictType;
  targetTitle: string;
  reason: string;
}

export interface DraftPointState {
  key: string;
  title: string;
  description: string;
  confidence: number;
  evidences: { material_id: string; quote: string }[];
}

/**
 * 块级修订记录(spec §9 规则 9:每次 AI 修订在块上追加一条)。
 * 与 core draftRevisionSchema(core DraftRevision,未从包顶层导出)同构,
 * 随草稿整体读写,应用落库后随需求点保留完整修订链。
 */
export interface DraftRevisionView {
  at: number;
  actor: string;
  annotation: string;
  scope: 'block' | 'point';
  pointTitle?: string;
}

export interface DraftBlockState {
  key: string;
  /** 左上角勾选角标(默认全选) */
  selected: boolean;
  title: string;
  summary: string;
  /** AI 归类建议(spec §9 规则 10):模块名;空串 = 未归类 */
  module: string;
  conflict: ConflictView | null;
  /** duplicate 默认 merge;contradiction 为 null 表示未裁决(应用禁用) */
  resolution: BlockResolution | null;
  points: DraftPointState[];
  /** AI 修订记录(时间倒序展示于修订弹窗;写回草稿时原样保留) */
  revisions: DraftRevisionView[];
}

export interface SupplementBlockState {
  key: string;
  selected: boolean;
  targetTitle: string;
  points: DraftPointState[];
}

export interface ExistingPointView {
  id: string;
  title: string;
  status: RequirementPointRow['status'];
  origin: string;
}

/** supplement/duplicate 目标需求的实时快照(server 侧按 title 匹配带出) */
export interface ExistingRequirementView {
  id: string;
  title: string;
  summary: string;
  status: RequirementRow['status'];
  priority: RequirementRow['priority'];
  points: ExistingPointView[];
}

// ---------- 本地 key 自增(草稿无 id,进程内唯一即可) ----------

let keySeq = 0;
function nextKey(prefix: string): string {
  return `${prefix}-${++keySeq}`;
}

/** 草稿点 → 本地编辑态(AI 产出或 UI 新增共用) */
export function toPointState(p: {
  title: string;
  description?: string;
  confidence?: number;
  evidences?: { material_id: string; quote: string }[];
}): DraftPointState {
  return {
    key: nextKey('p'),
    title: p.title,
    description: p.description ?? '',
    confidence: p.confidence ?? 0.5,
    evidences: p.evidences ?? [],
  };
}

/** 「新增需求」空块:默认带一个点引导填写 */
export function newBlockState(defaultTitle: string, defaultPointTitle: string): DraftBlockState {
  return {
    key: nextKey('b'),
    selected: true,
    title: defaultTitle,
    summary: '',
    module: '',
    conflict: null,
    resolution: null,
    points: [toPointState({ title: defaultPointTitle })],
    revisions: [],
  };
}

// ---------- 小控件 ----------

/** 勾选角标:圆形,选中 accent 底白勾 */
function CheckBadge({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={checked}
      title={label}
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-[120ms] ${
        checked
          ? 'border-accent bg-accent text-white'
          : 'border-draft-gray bg-transparent text-transparent hover:border-accent'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </button>
  );
}

/** 裁决选项 pill:选中 accent 实底 */
function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs transition-colors duration-[120ms] active:scale-[0.97] ${
        active
          ? 'bg-accent text-white'
          : 'border border-border bg-surface text-text-secondary hover:border-accent hover:text-accent'
      }`}
    >
      {children}
    </button>
  );
}

const ICON_BTN =
  'flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary';

function TrashIcon() {
  return (
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
      <path d="M4 7h16M10 11v6M14 11v6M6.5 7l1 13h9l1-13M9.5 7V4h5v3" />
    </svg>
  );
}

function PencilIcon() {
  return (
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
      <path d="M14.5 5.5l4 4L8 20H4v-4z" />
      <path d="M12.5 7.5l4 4" />
    </svg>
  );
}

/** 闪电图标(相悖块标识,spec 用 ⚡ 语义) */
function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5z" />
    </svg>
  );
}

/** ✦ 四角星(AI 修订入口标识,与素材面板「开始分析」同形) */
export function SparkleIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
    </svg>
  );
}

/** 立方体图标(模块语义,归类行用,12px) */
function BoxIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3 shrink-0 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

const POINT_INPUT =
  'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text-primary outline-none transition-colors focus:border-accent';

/** evidences → 去重来源素材名(缺失标题回退「未命名素材」;单条直出,多条「A、B +N」) */
function sourceNames(
  evidences: { material_id: string; quote: string }[],
  materialTitles: Record<string, string>,
): string {
  const seen = new Set<string>();
  for (const e of evidences) seen.add(e.material_id);
  const names = [...seen].map((id) => materialTitles[id] || '未命名素材');
  return names.length <= 2 ? names.join('、') : `${names[0]}、${names[1]} +${names.length - 2}`;
}

/** 块级聚合来源(各点 evidences 的 material_id 并集) */
function blockSourceNames(
  points: { evidences: { material_id: string; quote: string }[] }[],
  materialTitles: Record<string, string>,
): string {
  const all = points.flatMap((p) => p.evidences);
  return all.length > 0 ? sourceNames(all, materialTitles) : '';
}

// ---------- 模块归类 pill + 下拉(spec §9 规则 10 / D9) ----------

/**
 * 模块归类选择器:模块名 pill(bg-accent-dim / 未归类灰态),点击弹下拉。
 * 选项 = 未归类 + 项目模块列表 + 「+ 新建模块…」;选中即改块级 module(按名,
 * apply 时 core 按名匹配/新建)。新建走 onCreateModule(父级负责调 action、
 * toast 与列表刷新),成功后自动选中新名;失败(如重名)下拉保持打开。
 * 下拉交互与 ModuleMenu 同模式:点外 / Escape 关闭。
 */
function ModulePicker({
  value,
  modules,
  onCreateModule,
  onChange,
}: {
  value: string;
  modules: ModuleSummary[];
  onCreateModule: (name: string) => Promise<ModuleRow | null>;
  onChange: (module: string) => void;
}) {
  const t = useTranslations('analysis');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /** 选中即改块级 module 并收起下拉 */
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    setCreating(false);
    setNewName('');
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    try {
      const row = await onCreateModule(name);
      if (row) pick(row.name);
    } finally {
      setSubmitting(false);
    }
  };

  const ITEM_CLS =
    'flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-left text-xs text-text-primary transition-colors hover:bg-surface-2';

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('module')}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-[3px] text-[11px] font-medium transition-all duration-[120ms] active:scale-[0.97] ${
          value
            ? 'bg-accent-dim text-accent hover:opacity-90'
            : 'bg-surface-2 text-text-secondary hover:text-text-primary'
        }`}
      >
        <span className="max-w-40 truncate">{value || t('moduleUntagged')}</span>
        <span aria-hidden className="text-[9px] leading-none">
          ▾
        </span>
      </button>
      {open && (
        <span
          role="menu"
          className="dropdown-enter absolute left-0 top-[calc(100%+4px)] z-10 flex max-h-64 w-48 flex-col overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          <button type="button" role="menuitem" onClick={() => pick('')} className={ITEM_CLS}>
            <span className="w-3 shrink-0 text-accent">{value === '' ? '✓' : ''}</span>
            <span className={value === '' ? 'text-text-muted' : ''}>{t('moduleUntagged')}</span>
          </button>
          {modules.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitem"
              onClick={() => pick(m.name)}
              className={ITEM_CLS}
              title={m.description || undefined}
            >
              <span className="w-3 shrink-0 text-accent">{value === m.name ? '✓' : ''}</span>
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
            </button>
          ))}
          {creating ? (
            <div className="mt-0.5 flex items-center gap-1 border-t border-border px-2 py-1.5">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                placeholder={t('moduleNewPh')}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-primary outline-none transition-colors focus:border-accent"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newName.trim() || submitting}
                className="shrink-0 rounded-md px-1.5 py-1 text-xs text-accent transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('moduleCreate')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => setCreating(true)}
              className="mt-0.5 border-t border-border px-3 py-1.5 text-left text-xs text-accent transition-colors hover:bg-accent-dim"
            >
              + {t('moduleNew')}
            </button>
          )}
        </span>
      )}
    </span>
  );
}

// ---------- 需求点行(只读 / 内联编辑) ----------

function PointRow({
  point,
  onChange,
  onDelete,
  deleteLabel,
  materialTitles,
  onRevise,
}: {
  point: DraftPointState;
  onChange: (patch: Partial<DraftPointState>) => void;
  onDelete: () => void;
  deleteLabel: string;
  /** materialId → 素材标题(源头素材展示;缺失回退「未命名素材」) */
  materialTitles: Record<string, string>;
  /** 打开 AI 修订弹窗(单点作用域);补充块的点不参与修订(core 仅支持 requirements),不传则不渲染入口 */
  onRevise?: () => void;
}) {
  const t = useTranslations('analysis');
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg border border-accent/60 bg-accent-dim/40 p-2.5">
        <input
          value={point.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={t('block.pointTitlePlaceholder')}
          className={POINT_INPUT}
        />
        <textarea
          value={point.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={t('block.pointDescPlaceholder')}
          rows={2}
          className={`${POINT_INPUT} resize-y`}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            {t('block.save')}
          </button>
        </div>
      </div>
    );
  }

  const conf = Math.round(point.confidence * 100);

  return (
    <div className="group flex items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 transition-colors duration-[120ms] hover:border-border hover:bg-surface-2/60">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{point.title}</span>
          <span
            className={`shrink-0 text-[11px] tabular-nums ${
              conf >= 80 ? 'text-success' : conf >= 50 ? 'text-warning' : 'text-danger'
            }`}
          >
            {conf}%
          </span>
        </div>
        {point.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{point.description}</p>
        )}
        {point.evidences.length > 0 ? (
          <p className="mt-1 truncate text-[11px] text-text-muted">
            <span aria-hidden>📄 </span>
            <span title={point.evidences.map((e) => `「${e.quote}」`).join('\n')}>
              {sourceNames(point.evidences, materialTitles)}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-warning">{t('block.noEvidence')}</p>
        )}
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100">
        {onRevise && (
          <button
            type="button"
            onClick={onRevise}
            aria-label={t('revise.action')}
            title={t('revise.action')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-accent transition-colors hover:bg-accent-dim"
          >
            <SparkleIcon className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t('block.edit')}
          title={t('block.edit')}
          className={ICON_BTN}
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={deleteLabel}
          title={deleteLabel}
          className={ICON_BTN}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

// ---------- 草稿需求块(新 / duplicate / contradiction 共用) ----------

export function DraftBlock({
  block,
  modules,
  onCreateModule,
  materialTitles,
  onChange,
  onDelete,
  onRevise,
}: {
  block: DraftBlockState;
  /** 项目模块列表(下拉选项;由 workbench 拉取透传) */
  modules: ModuleSummary[];
  /** 下拉内新建模块:父级调 createModuleAction + toast + 列表刷新,返回新行/null */
  onCreateModule: (name: string) => Promise<ModuleRow | null>;
  /** materialId → 素材标题(块/点源头素材展示) */
  materialTitles: Record<string, string>;
  onChange: (patch: Partial<DraftBlockState>) => void;
  onDelete: () => void;
  /** 打开 AI 修订弹窗:pointIndex 为 null = 整块作用域,否则为点下标 */
  onRevise: (pointIndex: number | null) => void;
}) {
  const t = useTranslations('analysis');
  const c = block.conflict;

  return (
    // 白卡容器(原型 P3c 加强:无框白卡坐暖纸底;未勾选保留虚线 + 半透明)
    <div
      className={`group rounded-[14px] bg-surface p-5 transition-shadow duration-[120ms] hover:shadow-sm ${
        block.selected ? 'border border-transparent' : 'border border-dashed border-border opacity-55'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <CheckBadge
          checked={block.selected}
          onToggle={() => onChange({ selected: !block.selected })}
          label={t('selectBlock')}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <input
            value={block.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={t('block.titleLabel')}
            className="w-full rounded-md bg-transparent text-[17px] font-bold tracking-tight text-text-primary outline-none transition-colors placeholder:text-text-muted hover:bg-surface-2/60 focus:bg-surface-2/60"
          />
          <input
            value={block.summary}
            onChange={(e) => onChange({ summary: e.target.value })}
            placeholder={t('block.summaryPlaceholder')}
            className="w-full rounded-md bg-transparent text-xs text-text-secondary outline-none transition-colors placeholder:text-text-muted hover:bg-surface-2/60 focus:bg-surface-2/60"
          />
        </div>
        <div className="flex shrink-0 items-start gap-0.5">
          <button
            type="button"
            onClick={() => onRevise(null)}
            aria-label={t('revise.action')}
            title={t('revise.action')}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-accent opacity-0 transition-all duration-[120ms] hover:bg-accent-dim focus-visible:opacity-100 group-hover:opacity-100"
          >
            <SparkleIcon />
            {t('revise.action')}
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('block.delete')}
            title={t('block.delete')}
            className={ICON_BTN}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* 模块归类行(D9/AI 建议):pill 可改/新建;未给建议时空串灰态,提示语仅在有建议时展示 */}
      <div className="mt-3 flex items-center gap-2">
        <BoxIcon />
        <span className="shrink-0 text-[11px] text-text-muted">{t('module')}</span>
        <ModulePicker
          value={block.module}
          modules={modules}
          onCreateModule={onCreateModule}
          onChange={(module) => onChange({ module })}
        />
        {block.module && (
          <span className="min-w-0 truncate text-[10.5px] text-text-muted">{t('moduleAiHint')}</span>
        )}
      </div>

      {/* 块级来源素材(各点 evidences 聚合,悬停看各点引用原文) */}
      {(() => {
        const src = blockSourceNames(block.points, materialTitles);
        return src ? (
          <p className="mt-2 truncate text-[10.5px] text-text-muted">
            <span aria-hidden>📄 </span>
            <span title={block.points.flatMap((p) => p.evidences).map((e) => `「${e.quote}」`).join('\n')}>
              {t('block.sourceMaterials', { names: src })}
            </span>
          </p>
        ) : null;
      })()}

      {c?.type === 'duplicate' && (
        <div className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--draft-gray)_10%,transparent)] p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-draft-gray">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-draft-gray" />
            {t('conflict.duplicate')}
          </div>
          {c.reason && (
            <p className="mt-1 text-[11px] text-text-muted">
              {t('conflict.reasonLabel')}:{c.reason}
            </p>
          )}
          <div className="mt-2 flex gap-1.5">
            <Pill
              active={block.resolution !== 'create_anyway'}
              onClick={() => onChange({ resolution: 'merge' })}
            >
              {t('resolution.merge')}
            </Pill>
            <Pill
              active={block.resolution === 'create_anyway'}
              onClick={() => onChange({ resolution: 'create_anyway' })}
            >
              {t('resolution.createAnyway')}
            </Pill>
          </div>
        </div>
      )}

      {c?.type === 'contradiction' && (
        <div className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <BoltIcon />
            <span className="min-w-0 truncate">
              {t('conflict.contradiction', { target: c.targetTitle })}
            </span>
          </div>
          {c.reason && (
            <p className="mt-1 text-[11px] text-text-muted">
              {t('conflict.reasonLabel')}:{c.reason}
            </p>
          )}
          <div className="mt-2 flex gap-1.5">
            {(['use_new', 'use_old', 'keep_both'] as const).map((r) => (
              <Pill
                key={r}
                active={block.resolution === r}
                onClick={() => onChange({ resolution: r })}
              >
                {t(`resolution.${r}`)}
              </Pill>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <p className="text-[15px] font-bold tracking-tight text-text-muted">
          {t('block.pointsTitle')} ({block.points.length})
        </p>
        <div className="mt-1 space-y-0.5">
          {block.points.map((p, pi) => (
            <PointRow
              key={p.key}
              point={p}
              deleteLabel={t('block.delete')}
              materialTitles={materialTitles}
              onRevise={() => onRevise(pi)}
              onChange={(patch) =>
                onChange({
                  points: block.points.map((q) => (q.key === p.key ? { ...q, ...patch } : q)),
                })
              }
              onDelete={() => onChange({ points: block.points.filter((q) => q.key !== p.key) })}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            onChange({
              points: [...block.points, toPointState({ title: t('block.newPointDefaultTitle') })],
            })
          }
          className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-accent transition-colors hover:bg-accent-dim"
        >
          + {t('block.addPoint')}
        </button>
      </div>
    </div>
  );
}

// ---------- 补充块(带出完整已有需求) ----------

export function SupplementBlock({
  supp,
  existing,
  materialTitles,
  onChange,
  onDelete,
}: {
  supp: SupplementBlockState;
  existing?: ExistingRequirementView;
  /** materialId → 素材标题(新增点源头素材展示) */
  materialTitles: Record<string, string>;
  onChange: (patch: Partial<SupplementBlockState>) => void;
  onDelete: () => void;
}) {
  const t = useTranslations('analysis');

  return (
    // 白卡容器(原型 P3c 加强:无框白卡坐暖纸底;未勾选保留虚线 + 半透明)
    <div
      className={`rounded-[14px] bg-surface p-5 transition-shadow duration-[120ms] hover:shadow-sm ${
        supp.selected ? 'border border-transparent' : 'border border-dashed border-border opacity-55'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <CheckBadge
          checked={supp.selected}
          onToggle={() => onChange({ selected: !supp.selected })}
          label={t('selectBlock')}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex shrink-0 items-center rounded-full bg-[color-mix(in_srgb,var(--ai)_12%,transparent)] px-2 py-0.5 text-[11px] font-medium text-ai">
              {t('conflict.supplement')}
            </span>
            <span className="min-w-0 truncate text-[17px] font-bold tracking-tight text-text-primary">
              {supp.targetTitle}
            </span>
            {existing && <StatusBadge status={existing.status} size="sm" />}
          </div>
          {existing ? (
            existing.summary && (
              <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{existing.summary}</p>
            )
          ) : (
            <p className="mt-1 text-[11px] text-warning">{t('conflict.supplementNewTarget')}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('block.delete')}
          title={t('block.delete')}
          className={ICON_BTN}
        >
          <TrashIcon />
        </button>
      </div>

      {existing && existing.points.length > 0 && (
        <div className="mt-3">
          <p className="text-[15px] font-bold tracking-tight text-text-muted">
            {t('supplement.existingPoints')} ({existing.points.length})
          </p>
          <ul className="mt-1 space-y-0.5">
            {existing.points.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:border-border"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
                  {p.title}
                </span>
                <StatusBadge status={p.status} size="sm" />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <p className="text-[15px] font-bold tracking-tight text-text-muted">
          {t('supplement.newPoints')} ({supp.points.length})
        </p>
        <div className="mt-1 space-y-0.5">
          {supp.points.map((p) => (
            <PointRow
              key={p.key}
              point={p}
              deleteLabel={t('block.delete')}
              materialTitles={materialTitles}
              onChange={(patch) =>
                onChange({
                  points: supp.points.map((q) => (q.key === p.key ? { ...q, ...patch } : q)),
                })
              }
              onDelete={() => onChange({ points: supp.points.filter((q) => q.key !== p.key) })}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            onChange({
              points: [...supp.points, toPointState({ title: t('block.newPointDefaultTitle') })],
            })
          }
          className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-accent transition-colors hover:bg-accent-dim"
        >
          + {t('block.addPoint')}
        </button>
      </div>
    </div>
  );
}
