'use server';

import type {
  CreateGroupInput,
  CreateProjectInput,
  GroupRow,
  GroupWithCount,
  ProjectRow,
  ProjectSummary,
  UpdateGroupInput,
  UpdateProjectInput,
} from '@shipmate/core';
import { getShipmate } from '@/lib/core';
import { toActionError, type ActionResult } from '@/lib/error';
import { revalidateApp } from '@/lib/revalidate';

/**
 * 项目与分组 action。
 * 分组 action 并入本文件:计划 File Structure 约定 actions 仅五文件
 * {projects, analysis, points, tasks, settings},分组属项目组织域。
 *
 * 约定:读 action 直接返回数据(失败抛错,由页面错误边界处理);
 * 写 action 返回 ActionResult(DomainError.message 中文直出供 toast)。
 * actor 固定 'human'(spec §5.1:web 门面)。
 */

// ---------- 读 ----------

/** 分组列表(含项目计数)——侧栏与 P1 首页分区 */
export async function listGroups(): Promise<GroupWithCount[]> {
  const { core } = await getShipmate();
  return core.groups.listGroups();
}

/** 项目列表;filter.groupId 传 null 取未分组 */
export async function listProjects(
  filter?: { groupId?: string | null },
): Promise<ProjectRow[]> {
  const { core } = await getShipmate();
  return core.projects.listProjects(filter);
}

/** P1 首页聚合:分组(带计数)+ 全量项目 + 未分组项目 */
export async function getHomeOverview(): Promise<{
  groups: GroupWithCount[];
  grouped: ProjectRow[];
  ungrouped: ProjectRow[];
}> {
  const { core } = await getShipmate();
  const [groups, all, ungrouped] = await Promise.all([
    core.groups.listGroups(),
    core.projects.listProjects(),
    core.projects.listProjects({ groupId: null }),
  ]);
  return { groups, grouped: all, ungrouped };
}

/** 项目概览摘要(需求完成度/超期数/点状态分布/最近变更)——P1 卡片与 P2 概览 */
export async function getProject(id: string): Promise<ProjectSummary> {
  const { core } = await getShipmate();
  return core.projects.getProject(id);
}

// ---------- 写(分组) ----------

export async function createGroupAction(
  input: CreateGroupInput,
): Promise<ActionResult<GroupRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.groups.createGroup(input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateGroupAction(
  id: string,
  input: UpdateGroupInput,
): Promise<ActionResult<GroupRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.groups.updateGroup(id, input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteGroupAction(id: string): Promise<ActionResult> {
  try {
    const { core } = await getShipmate();
    await core.groups.deleteGroup(id, 'human');
    revalidateApp();
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------- 写(项目) ----------

export async function createProjectAction(
  input: CreateProjectInput,
): Promise<ActionResult<ProjectRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.projects.createProject(input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateProjectAction(
  id: string,
  input: UpdateProjectInput,
): Promise<ActionResult<ProjectRow>> {
  try {
    const { core } = await getShipmate();
    const row = await core.projects.updateProject(id, input, 'human');
    revalidateApp();
    return { ok: true, data: row };
  } catch (e) {
    return toActionError(e);
  }
}
