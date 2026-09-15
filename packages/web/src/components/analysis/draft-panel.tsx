'use client';

import { useTranslations } from 'next-intl';
import type { ModuleRow, ModuleSummary } from '@shipmate/core';
import { Skeleton } from '@/components/shared/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import {
  DraftBlock,
  SupplementBlock,
  newBlockState,
  type DraftBlockState,
  type ExistingRequirementView,
  type SupplementBlockState,
} from '@/components/analysis/draft-block';

/**
 * P3c 右栏:分析产出草稿区。
 * 三态:无草稿占位 → 分析中骨架屏(渐变呼吸)→ 草稿块列表(stagger 40ms 淡入)。
 * 顶部工具条:草稿统计 + 已选数 + 「应用」(相悖未裁决或无勾选时禁用)。
 */
export function DraftPanel({
  blocks,
  supps,
  existingByTitle,
  modules,
  onCreateModule,
  materialTitles,
  analyzing,
  applying,
  applyDisabled,
  unresolvedCount,
  onBlocksChange,
  onSuppsChange,
  onApply,
  onRevise,
}: {
  blocks: DraftBlockState[];
  supps: SupplementBlockState[];
  existingByTitle: Map<string, ExistingRequirementView>;
  /** 项目模块列表(workbench 拉取;归类下拉选项) */
  modules: ModuleSummary[];
  /** 归类下拉内新建模块(workbench 处理 action/toast/列表刷新) */
  onCreateModule: (name: string) => Promise<ModuleRow | null>;
  /** materialId → 素材标题(块/点源头素材展示) */
  materialTitles: Record<string, string>;
  analyzing: boolean;
  applying: boolean;
  applyDisabled: boolean;
  unresolvedCount: number;
  onBlocksChange: (next: DraftBlockState[]) => void;
  onSuppsChange: (next: SupplementBlockState[]) => void;
  onApply: () => void;
  /** 打开 AI 修订弹窗(块下标 + 点下标,null = 整块);补充块不参与(core 仅支持 requirements) */
  onRevise: (blockIndex: number, pointIndex: number | null) => void;
}) {
  const t = useTranslations('analysis');
  const hasDraft = blocks.length > 0 || supps.length > 0;
  const selectedCount =
    blocks.filter((b) => b.selected).length + supps.filter((s) => s.selected).length;

  return (
    // 面板外壳透明(原型 P3c 加强:左右栏为暖纸底上的透明分区,草稿块为白卡)
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold tracking-tight text-text-primary">{t('title')}</h2>
          {hasDraft && !analyzing && (
            <p className="mt-0.5 text-xs text-text-muted">
              {t('draftSummary', { requirements: blocks.length, supplements: supps.length })}
              <span aria-hidden> · </span>
              {t('reviseHint')}
            </p>
          )}
        </div>
        {hasDraft && (
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="text-xs text-text-muted">
              {t('selectedCount', { count: selectedCount })}
            </span>
            <button
              type="button"
              onClick={onApply}
              disabled={applyDisabled}
              className="h-8 rounded-full bg-accent px-3.5 text-xs font-medium text-white transition-all duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying ? t('applying') : t('apply')}
            </button>
          </div>
        )}
      </header>

      {unresolvedCount > 0 && (
        <p className="shrink-0 border-b border-border bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-4 py-1.5 text-xs text-warning">
          {t('conflict.unresolved')}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {analyzing ? (
          <div className="space-y-4" aria-busy="true">
            <p className="text-sm text-text-secondary">{t('resultSkeleton')}</p>
            <Skeleton lines={10} />
            <Skeleton lines={4} />
          </div>
        ) : !hasDraft ? (
          <EmptyState
            title={t('resultPlaceholderTitle')}
            description={t('resultPlaceholderDesc')}
          />
        ) : (
          <div className="space-y-3">
            {blocks.map((b, i) => (
              <div key={b.key} className="analysis-enter" style={{ animationDelay: `${i * 40}ms` }}>
                <DraftBlock
                  block={b}
                  modules={modules}
                  onCreateModule={onCreateModule}
                  materialTitles={materialTitles}
                  onChange={(patch) =>
                    onBlocksChange(blocks.map((q) => (q.key === b.key ? { ...q, ...patch } : q)))
                  }
                  onDelete={() => onBlocksChange(blocks.filter((q) => q.key !== b.key))}
                  onRevise={(pointIndex) => onRevise(i, pointIndex)}
                />
              </div>
            ))}
            {supps.map((s, i) => (
              <div
                key={s.key}
                className="analysis-enter"
                style={{ animationDelay: `${(blocks.length + i) * 40}ms` }}
              >
                <SupplementBlock
                  supp={s}
                  existing={existingByTitle.get(s.targetTitle)}
                  materialTitles={materialTitles}
                  onChange={(patch) =>
                    onSuppsChange(supps.map((q) => (q.key === s.key ? { ...q, ...patch } : q)))
                  }
                  onDelete={() => onSuppsChange(supps.filter((q) => q.key !== s.key))}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                onBlocksChange([
                  ...blocks,
                  newBlockState(t('block.newDefaultTitle'), t('block.newPointDefaultTitle')),
                ])
              }
              className="flex h-11 w-full items-center justify-center gap-1 rounded-xl border border-dashed border-border text-sm text-text-secondary transition-colors duration-[120ms] hover:border-accent hover:text-accent"
            >
              + {t('block.add')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
