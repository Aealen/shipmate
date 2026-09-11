'use server';

import type {
  ChangeLogRow,
  CreateTaskInput,
  ListTaskFilter,
  TaskAction,
  TaskRow,
  UpdateTaskInput,
} from '@shipmate/core';
import { getShipmate } from '@/lib/core';
import { toActionError, type ActionResult } from '@/lib/error';
import { revalidateApp } from '@/lib/revalidate';

/**
 * 任务 action。
 * 约定:读 action 直接返回数据;写 action 返回 ActionResult(中文 message 供 toast)。
 * actor 固定 'human'(spec §5.1:web 门面)。
 */

// ---------- 读 ----------

/** 任务列表(看板按 status 分列,详情页按需求点) */
export async function listTasks(filter: ListTaskFilter): Promise<TaskRow[]> {
  const { core } = await getShipmate();
  return core.tasks.listTasks(filter);
}

/** 任务变更历史(P4 关联任务 / P5c 重估原因取最近 status_change 日志 reason) */
export async function getTaskChangeLogs(taskId: string): Promise<ChangeLogRow[]> {
  const { core } = await getShipmate();
  return core.audit.getChangeLog({ entityType: 'task', entityId: taskId });
}

// ---------- 写 ----------

export async function createTaskAction(
  input: CreateTaskInput,
): Promise<ActionResult<TaskRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.tasks.createTask(input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateTaskAction(
  id: string,
  input: UpdateTaskInput,
): Promise<ActionResult<TaskRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.tasks.updateTask(id, input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

/** 看板拖拽换列:start(pending→in_progress)/ complete(in_progress→done) */
export async function setTaskStatusAction(
  id: string,
  action: TaskAction,
): Promise<ActionResult<TaskRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.tasks.setTaskStatus(id, action, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

/** 确认重估:needs_reassessment → pending(P5c 弹窗确认按钮) */
export async function confirmTaskReassessmentAction(
  id: string,
): Promise<ActionResult<TaskRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.tasks.confirmTaskReassessment(id, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}
