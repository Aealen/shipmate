import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Actor, ShipmateCore } from '@shipmate/core';
import { withCore } from '../util.js';

export function registerModuleTools(server: McpServer, core: ShipmateCore, actor: Actor): void {
  server.registerTool(
    'create_module',
    {
      title: '创建模块',
      description: '在项目下创建模块(需求分类容器,纯分组无状态),返回新建的模块对象',
      inputSchema: {
        projectId: z.string().describe('所属项目 id'),
        name: z.string().describe('模块名(同项目内唯一)'),
        description: z.string().optional().describe('模块描述'),
      },
    },
    withCore(core, actor, (c, args) => c.modules.createModule(args, actor)),
  );

  server.registerTool(
    'update_module',
    {
      title: '更新模块',
      description: '修改模块名称、描述或排序,返回更新后的模块对象',
      inputSchema: {
        id: z.string().describe('模块 id'),
        name: z.string().optional().describe('新模块名'),
        description: z.string().optional().describe('新描述'),
        sortOrder: z.number().int().optional().describe('排序值'),
      },
    },
    withCore(core, actor, (c, { id, ...patch }) => c.modules.updateModule(id, patch, actor)),
  );

  server.registerTool(
    'delete_module',
    {
      title: '删除模块',
      description:
        '删除模块,其下需求转为未归类(需求本身保留);删除快照留存变更历史',
      inputSchema: { id: z.string().describe('模块 id') },
    },
    withCore(core, actor, (c, { id }) => c.modules.deleteModule(id, actor)),
  );

  server.registerTool(
    'list_modules',
    {
      title: '列出模块',
      description:
        '返回项目下模块数组(按 sortOrder→name 排序),每项含需求数(requirementCount)与需求点就绪统计(pointsDone/pointsTotal)',
      inputSchema: { projectId: z.string().describe('项目 id') },
    },
    withCore(core, actor, (c, { projectId }) => c.modules.listModules(projectId)),
  );
}
