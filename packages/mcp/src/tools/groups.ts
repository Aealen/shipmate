import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Actor, ShipmateCore } from '@shipmate/core';
import { withCore } from '../util.js';

export function registerGroupTools(server: McpServer, core: ShipmateCore, actor: Actor): void {
  server.registerTool(
    'create_group',
    {
      title: '创建分组',
      description: '创建项目分组(组织维度),返回新建的分组对象',
      inputSchema: {
        name: z.string().describe('分组名'),
        description: z.string().optional().describe('分组描述'),
      },
    },
    withCore(core, actor, (c, args) => c.groups.createGroup(args, actor)),
  );

  server.registerTool(
    'update_group',
    {
      title: '更新分组',
      description: '修改分组名称、描述或排序,返回更新后的分组对象',
      inputSchema: {
        id: z.string().describe('分组 id'),
        name: z.string().optional().describe('新分组名'),
        description: z.string().optional().describe('新描述'),
        sortOrder: z.number().int().optional().describe('排序值'),
      },
    },
    withCore(core, actor, (c, { id, ...patch }) => c.groups.updateGroup(id, patch, actor)),
  );

  server.registerTool(
    'delete_group',
    {
      title: '删除分组',
      description: '删除空分组;组内仍有项目时拒绝(GROUP_NOT_EMPTY)',
      inputSchema: { id: z.string().describe('分组 id') },
    },
    withCore(core, actor, (c, { id }) => c.groups.deleteGroup(id, actor)),
  );

  server.registerTool(
    'list_groups',
    {
      title: '列出分组',
      description: '返回全部分组数组,每项含项目数(projectCount)',
      inputSchema: {},
    },
    withCore(core, actor, (c) => c.groups.listGroups()),
  );

  server.registerTool(
    'get_group',
    {
      title: '查询分组',
      description: '查询单个分组,附组内项目列表及各项目的需求完成度',
      inputSchema: { id: z.string().describe('分组 id') },
    },
    withCore(core, actor, (c, { id }) => c.groups.getGroup(id)),
  );
}
