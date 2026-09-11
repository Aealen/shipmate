import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Actor, ShipmateCore } from '@shipmate/core';
import { withCore } from '../util.js';

export function registerProjectTools(server: McpServer, core: ShipmateCore, actor: Actor): void {
  server.registerTool(
    'create_project',
    {
      title: '创建项目',
      description: '创建项目(可归属分组),返回新建的项目对象',
      inputSchema: {
        groupId: z.string().optional().describe('所属分组 id,缺省为无分组'),
        name: z.string().describe('项目名'),
        description: z.string().optional().describe('项目描述'),
      },
    },
    withCore(core, actor, (c, args) => c.projects.createProject(args, actor)),
  );

  server.registerTool(
    'update_project',
    {
      title: '更新项目',
      description: '修改项目名称、描述或状态(active/archived),返回更新后的项目对象',
      inputSchema: {
        id: z.string().describe('项目 id'),
        name: z.string().optional().describe('新项目名'),
        description: z.string().optional().describe('新描述'),
        status: z.enum(['active', 'archived']).optional().describe('项目状态'),
      },
    },
    withCore(core, actor, (c, { id, ...patch }) => c.projects.updateProject(id, patch, actor)),
  );

  server.registerTool(
    'list_projects',
    {
      title: '列出项目',
      description:
        '返回项目数组;groupId 不传返回全部,传具体 id 返回该组项目,传 null 仅返回无分组项目',
      inputSchema: {
        groupId: z.string().nullable().optional().describe('按分组过滤:null=仅无分组项目'),
      },
    },
    withCore(core, actor, (c, { groupId }) =>
      c.projects.listProjects(groupId === undefined ? {} : { groupId }),
    ),
  );

  server.registerTool(
    'get_project',
    {
      title: '查询项目',
      description: '查询项目概要(即进度):需求完成度、需求点状态分布、超期需求数、最近 20 条变更',
      inputSchema: { id: z.string().describe('项目 id') },
    },
    withCore(core, actor, (c, { id }) => c.projects.getProject(id)),
  );
}
