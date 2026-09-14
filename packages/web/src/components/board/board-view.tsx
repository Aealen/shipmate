'use client';

import { Fragment, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DragEvent } from 'react';
import type { ModuleSummary, TaskAction, TaskRow } from '@shipmate/core';
import { setTaskStatusAction } from '@/actions/tasks';
import { ReassessModal } from '@/components/board/reassess-modal';
import { TaskCard } from '@/components/board/task-card';
import { showToast } from '@/components/shared/toast';

type TaskStatus = TaskRow['status'];

/** 模块筛选值:all = 全部模块(默认);UNTAGGED = 未归类(需求无模块);其余为模块 id */
const MODULE_UNTAGGED = '__untagged';
type ModuleFilter = typeof MODULE_UNTAGGED | 'all' | string;

/** 看板四列:pending → in_progress → done;needs_reassessment 为 danger 警示列 */
const COLUMNS: TaskStatus[] = ['pending', 'in_progress', 'done', 'needs_reassessment'];

/** 列头圆点色(原型 P5:pending 灰 / in_progress 蓝 / done 绿 / 重估橙) */
const COLUMN_DOT: Record<TaskStatus, string> = {
  pending: 'bg-draft-gray',
  in_progress: 'bg-accent',
  done: 'bg-success',
  needs_reassessment: 'bg-warning',
};

/**
 * 拖拽落位合法性(与 core TASK_TRANSITIONS 一致):
 * pending→in_progress(start)、in_progress→done(complete);
 * 其余落位(done→pending、pending→done、needs_reassessment 拖出等)一律非法——
 * 不调 action,直接回弹;needs_reassessment 移出只能走「确认重估」按钮。
 */
function dropAction(from: TaskStatus, to: TaskStatus): TaskAction | null {
  if (from === 'pending' && to === 'in_progress') return 'start';
  if (from === 'in_progress' && to === 'done') return 'complete';
  return null;
}

/** spec §14:落位占位符呼吸提示(呼吸动画内联注入一次,避免改动全局 globals.css) */
const BREATHE_KEYFRAMES = '@keyframes sm-breathe{0%,100%{opacity:.45}50%{opacity:1}}';

interface OverTarget {
  column: TaskStatus;
  index: number;
}

/**
 * P5 任务看板主体(客户端):模块筛选行 + 四列 + HTML5 原生拖拽换列。
 * 模块筛选按 任务→需求点→需求→moduleId 链过滤任务卡(page 端已折叠为 pointId→moduleId);
 * 拖拽抬起(原位卡阴影 + scale(1.02) 120ms)→ 目标列呼吸占位符 →
 * drop 合法调 set_task_status(revalidate 刷新),非法不调、自动回弹。
 */
export function BoardView({
  projectId,
  tasks,
  pointTitles,
  modules,
  pointModuleIds,
}: {
  projectId: string;
  tasks: TaskRow[];
  pointTitles: Record<string, string>;
  modules: ModuleSummary[];
  pointModuleIds: Record<string, string | null>;
}) {
  const t = useTranslations('board');
  // dragId 延迟一帧设置:dragstart 同步截取的拖拽影像保持卡片原貌,抬起态只作用原位卡
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<OverTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [reassessTask, setReassessTask] = useState<TaskRow | null>(null);
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all');

  /** 任务按所选模块过滤:经卡的 requirementPointId 查 moduleId(null = 未归类) */
  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const moduleId = pointModuleIds[task.requirementPointId] ?? null;
        return (
          moduleFilter === 'all' ||
          (moduleFilter === MODULE_UNTAGGED ? moduleId === null : moduleId === moduleFilter)
        );
      }),
    [tasks, moduleFilter, pointModuleIds],
  );

  const byColumn = useMemo(() => {
    const sorted = [...visibleTasks].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt,
    );
    const map: Record<TaskStatus, TaskRow[]> = {
      pending: [],
      in_progress: [],
      done: [],
      needs_reassessment: [],
    };
    for (const task of sorted) map[task.status].push(task);
    return map;
  }, [visibleTasks]);

  const dragFrom = dragId ? (tasks.find((task) => task.id === dragId)?.status ?? null) : null;

  function handleDragStart(taskId: string) {
    // setTimeout 0:让 dragstart 事件先完成(拖拽影像此时已按原样截取)
    window.setTimeout(() => setDragId(taskId), 0);
  }

  function handleDragEnd() {
    setDragId(null);
    setOver(null);
  }

  /** 列容器 dragover:按指针 Y 与卡片中点比较计算插入位(占位符 pointer-events-none 不拦截) */
  function handleColumnDragOver(e: DragEvent<HTMLDivElement>, column: TaskStatus) {
    e.preventDefault();
    const legal = dragFrom !== null && dropAction(dragFrom, column) !== null;
    e.dataTransfer.dropEffect = legal ? 'move' : 'none';
    const cards = e.currentTarget.querySelectorAll<HTMLElement>('[data-task-card]');
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const box = cards[i]!.getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) {
        index = i;
        break;
      }
    }
    setOver((prev) => (prev?.column === column && prev.index === index ? prev : { column, index }));
  }

  function handleColumnDragLeave(e: DragEvent<HTMLDivElement>, column: TaskStatus) {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setOver((prev) => (prev?.column === column ? null : prev));
  }

  async function handleDrop(column: TaskStatus) {
    const id = dragId;
    const from = dragFrom;
    setDragId(null);
    setOver(null);
    if (!id || !from || busy) return;
    const action = dropAction(from, column);
    // 非法落位(如 done→pending):不调 action,卡片随状态未变而回弹
    if (!action) return;
    setBusy(true);
    const res = await setTaskStatusAction(id, action);
    setBusy(false);
    if (!res.ok) showToast(res.message, 'error');
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <style>{BREATHE_KEYFRAMES}</style>
      {/* 模块筛选(看板无既有筛选控件,按 spec §14 置于列头行上方右侧);无模块时整行不渲染 */}
      {modules.length > 0 && (
        <div className="flex justify-end">
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            {t('moduleLabel')}
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="h-8 rounded-[8px] border border-border bg-surface px-2 text-[13px] text-text-primary outline-none transition-colors focus:border-accent"
            >
              <option value="all">{t('moduleAll')}</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value={MODULE_UNTAGGED}>{t('moduleUntagged')}</option>
            </select>
          </label>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((status) => {
        const cards = byColumn[status];
        const legal = dragFrom !== null && dropAction(dragFrom, status) !== null;
        const isOver = over?.column === status && dragId !== null;
        return (
          <section key={status} className="flex min-w-0 flex-col gap-2.5">
            <header className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-[4px] ${COLUMN_DOT[status]}`} />
              <span
                className={`text-[13px] font-bold leading-none ${
                  status === 'needs_reassessment' ? 'text-warning' : 'text-text-primary'
                }`}
              >
                {t(`column.${status}`)}
              </span>
              <span className="inline-flex shrink-0 items-center rounded-[5px] bg-surface-2 px-[7px] py-[2px] text-[11px] leading-none text-text-secondary tabular-nums">
                {cards.length}
              </span>
            </header>
            <div
              className={`flex min-h-[120px] flex-col gap-2 rounded-lg p-0.5 ${
                isOver && legal ? 'bg-accent-dim' : ''
              } ${isOver && !legal ? 'bg-surface-2' : ''}`}
              onDragOver={(e) => handleColumnDragOver(e, status)}
              onDragLeave={(e) => handleColumnDragLeave(e, status)}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(status);
              }}
            >
              {cards.map((task, i) => (
                <Fragment key={task.id}>
                  {isOver && over?.index === i && <DropPlaceholder legal={legal} />}
                  <TaskCard
                    task={task}
                    pointTitle={pointTitles[task.requirementPointId]}
                    projectId={projectId}
                    dragging={dragId === task.id}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onConfirmReassess={setReassessTask}
                  />
                </Fragment>
              ))}
              {isOver && over !== null && over.index >= cards.length && (
                <DropPlaceholder legal={legal} />
              )}
              {cards.length === 0 && !isOver && (
                <p className="px-2 py-6 text-center text-xs text-text-muted">{t('emptyColumn')}</p>
              )}
            </div>
          </section>
        );
      })}

      <ReassessModal
        open={reassessTask !== null}
        taskId={reassessTask?.id ?? null}
        taskTitle={reassessTask?.title ?? ''}
        pointId={reassessTask?.requirementPointId ?? null}
        pointTitle={reassessTask ? pointTitles[reassessTask.requirementPointId] : undefined}
        projectId={projectId}
        onClose={() => setReassessTask(null)}
      />
      </div>
    </div>
  );
}

/** 落位占位符:合法列 accent 呼吸、非法列中性灰,pointer-events-none 不影响 hit-testing */
function DropPlaceholder({ legal }: { legal: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none flex h-12 items-center justify-center rounded-lg border-2 border-dashed"
      style={{
        animation: 'sm-breathe 1.2s ease-in-out infinite',
        borderColor: legal ? 'var(--accent)' : 'var(--border)',
        background: legal ? 'var(--accent-dim)' : 'transparent',
      }}
    />
  );
}
