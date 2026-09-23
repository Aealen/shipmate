'use client';

import type { ModuleSummary, RequirementWithOverdue, UpdateRequirementInput } from '@shipmate/core';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { updateRequirementAction } from '@/actions/analysis';
import { showToast } from '@/components/shared/toast';

/** spec §14:弹窗开关动画 120ms(与 shared/modal 一致) */
const ANIM_MS = 120;

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
const STATUSES = ['draft', 'confirmed', 'done', 'archived'] as const;

const inputClass =
  'w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors duration-[120ms] placeholder:text-text-muted focus:border-accent';

/** 状态选项 → browse.edit 翻译键(中文标签,与 shared.badge 同文案) */
const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = {
  draft: 'statusDraft',
  confirmed: 'statusConfirmed',
  done: 'statusDone',
  archived: 'statusArchived',
};

/** 毫秒时间戳 → date input 值(本地时区 YYYY-MM-DD);空值为空串 */
function toDateInput(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** date input 值 → 本地时区当日零点毫秒;空串 → null(清除排期) */
function fromDateInput(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

/**
 * 需求编辑弹窗(原型 P3i,需求产出块头 ✏ 入口):
 * 标题/摘要/优先级/状态/计划开始/计划结束,保存经 {@link updateRequirementAction}
 * 只提交变更字段(未变更字段不下发,core updateRequirement 按字段 diff 决定是否记修订)。
 * 壳为手写弹窗(createPortal + 120ms 开关动画),与 P2c/P3f 手写弹窗同族;
 * Escape 与遮罩点击关闭,不做未保存改动拦截(与 EditPointModal 同等简单度)。
 */
export function RequirementEditModal({
  requirement,
  modules,
  open,
  onClose,
  onSaved,
}: {
  requirement: RequirementWithOverdue;
  /** 模块列表(P3k,由 analysis-browse 下发;模块下拉选项用) */
  modules: ModuleSummary[];
  open: boolean;
  onClose: () => void;
  /** 保存成功后回调(父组件刷新列表用),可选 */
  onSaved?: () => void;
}) {
  const t = useTranslations('browse.edit');
  const ts = useTranslations('shared');

  const [title, setTitle] = useState(requirement.title);
  const [summary, setSummary] = useState(requirement.summary ?? '');
  const [status, setStatus] = useState<RequirementWithOverdue['status']>(requirement.status);
  const [priority, setPriority] = useState<RequirementWithOverdue['priority']>(requirement.priority);
  // 模块下拉值用 '' 表示未归类(core 侧 moduleId 为可空 text)
  const [moduleId, setModuleId] = useState(requirement.moduleId ?? '');
  const [planStart, setPlanStart] = useState(toDateInput(requirement.planStartAt));
  const [planDue, setPlanDue] = useState(toDateInput(requirement.planDueAt));
  const [saving, setSaving] = useState(false);

  // 弹窗壳:mounted 控制是否渲染(DOM 存在),shown 控制动画目标态
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  // 每次打开重置为当前需求值(编辑中路由自动刷新不打断输入)
  useEffect(() => {
    if (open) {
      setTitle(requirement.title);
      setSummary(requirement.summary ?? '');
      setStatus(requirement.status);
      setPriority(requirement.priority);
      setModuleId(requirement.moduleId ?? '');
      setPlanStart(toDateInput(requirement.planStartAt));
      setPlanDue(toDateInput(requirement.planDueAt));
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      setShown(false);
      const timer = setTimeout(() => setMounted(false), ANIM_MS);
      return () => clearTimeout(timer);
    }
    setMounted(true);
    // 双 rAF:先让初始态(透明、上移 4px)完成一帧绘制再切目标态,过渡才生效
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

  // 标题必填非空,空值禁用保存
  const canSubmit = title.trim().length > 0 && !saving;

  /** 与 requirement 当前值逐项 diff,只收变更字段(空 patch 由 core 幂等返回原行) */
  const buildPatch = (): UpdateRequirementInput => {
    const patch: UpdateRequirementInput = {};
    const trimmedTitle = title.trim();
    if (trimmedTitle !== requirement.title) patch.title = trimmedTitle;
    if (summary !== (requirement.summary ?? '')) patch.summary = summary;
    if (status !== requirement.status) patch.status = status;
    if (priority !== requirement.priority) patch.priority = priority;
    // 模块:空串 = 未归类(core 显式 null);与当前值不同才提交
    const nextModuleId = moduleId === '' ? null : moduleId;
    if (nextModuleId !== requirement.moduleId) patch.moduleId = nextModuleId;
    const startMs = fromDateInput(planStart);
    if (startMs !== requirement.planStartAt) patch.planStartAt = startMs;
    const dueMs = fromDateInput(planDue);
    if (dueMs !== requirement.planDueAt) patch.planDueAt = dueMs;
    return patch;
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const res = await updateRequirementAction(requirement.id, buildPatch());
    setSaving(false);
    if (res.ok) {
      onSaved?.();
      onClose();
    } else {
      showToast(res.message, 'error');
    }
  };

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
        aria-label={t('title')}
        className={`relative flex max-h-[85vh] w-full max-w-[min(620px,92vw)] flex-col rounded-md bg-surface p-[22px] shadow-xl transition-all duration-[120ms] ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        }`}
      >
        {/* 头部:✏ 图标块 + 标题 + 圆形关闭钮 */}
        <div className="flex shrink-0 items-center gap-2.5">
          <span
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-accent-dim text-[12px] text-accent"
            aria-hidden
          >
            ✏
          </span>
          <h2 className="min-w-0 flex-1 text-[17px] font-bold tracking-tight text-text-primary">
            {t('title')}
          </h2>
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
          {/* 标题(必填) */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-text-muted">{t('titleLabel')}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className={inputClass}
            />
          </label>

          {/* 摘要 */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-text-muted">{t('summary')}</span>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              className={`resize-none ${inputClass}`}
            />
          </label>

          {/* 优先级 + 状态 */}
          <div className="flex gap-2.5">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[11px] font-bold text-text-muted">{t('priority')}</span>
              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as RequirementWithOverdue['priority'])
                }
                className={inputClass}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`priority${p}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[11px] font-bold text-text-muted">{t('status')}</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as RequirementWithOverdue['status'])}
                className={inputClass}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(STATUS_LABELS[s])}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* 模块(P3k:未归类 + 模块列表,归属变更也记修订) */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-text-muted">{t('module')}</span>
            <select
              value={moduleId}
              onChange={(e) => setModuleId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t('moduleUntagged')}</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          {/* 计划开始 + 计划结束(date input,提交转本地时区当日零点毫秒) */}
          <div className="flex gap-2.5">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[11px] font-bold text-text-muted">{t('planStart')}</span>
              <input
                type="date"
                value={planStart}
                onChange={(e) => setPlanStart(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[11px] font-bold text-text-muted">{t('planDue')}</span>
              <input
                type="date"
                value={planDue}
                onChange={(e) => setPlanDue(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          {/* 修订提示条:保存即记一次修订 */}
          <div className="flex items-center gap-2 rounded-lg bg-accent-dim px-3 py-2.5">
            <span className="shrink-0 text-xs text-accent" aria-hidden>
              ✨
            </span>
            <span className="text-[11.5px] leading-snug text-accent">{t('revisionHint')}</span>
          </div>
        </div>

        {/* 底部操作:右对齐 取消 / 保存 */}
        <div className="flex shrink-0 items-center justify-end gap-2.5 pt-3.5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg bg-surface-2 px-4 py-[9px] text-[13px] text-text-secondary transition-colors duration-[120ms] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-full bg-accent px-4 py-[9px] text-[13px] font-bold text-white transition-opacity duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
