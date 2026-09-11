import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Actor, ShipmateCore } from '@shipmate/core';
import { withCore } from '../util.js';

export function registerTaskTools(server: McpServer, core: ShipmateCore, actor: Actor): void {
  server.registerTool(
    'create_task',
    {
      title: '创建任务',
      description: '在需求点下创建开发任务,默认 pending 态',
      inputSchema: {
        requirementPointId: z.string().describe('所属需求点 id'),
        title: z.string().describe('任务标题'),
        description: z.string().optional().describe('任务描述'),
        sortOrder: z.number().int().optional().describe('排序值,缺省 0'),
      },
    },
    withCore(core, actor, (c, args) => c.tasks.createTask(args, actor)),
  );

  server.registerTool(
    'update_task',
    {
      title: '更新任务',
      description: '修改任务标题、描述或排序',
      inputSchema: {
        id: z.string().describe('任务 id'),
        title: z.string().optional().describe('新标题'),
        description: z.string().optional().describe('新描述'),
        sortOrder: z.number().int().optional().describe('新排序值'),
      },
    },
    withCore(core, actor, (c, { id, ...patch }) => c.tasks.updateTask(id, patch, actor)),
  );

  server.registerTool(
    'set_task_status',
    {
      title: '流转任务状态',
      description:
        '按状态机流转任务:start(pending→in_progress)、complete(in_progress→done);非法流转返回 INVALID_STATUS_TRANSITION',
      inputSchema: {
        id: z.string().describe('任务 id'),
        action: z.enum(['start', 'complete']).describe('流转动作'),
      },
    },
    withCore(core, actor, (c, { id, action }) => c.tasks.setTaskStatus(id, action, actor)),
  );

  server.registerTool(
    'list_tasks',
    {
      title: '列出任务',
      description: '列出任务,可按需求点/项目/状态过滤',
      inputSchema: {
        requirementPointId: z.string().optional().describe('按需求点 id 过滤'),
        projectId: z.string().optional().describe('按项目 id 过滤'),
        status: z
          .enum(['pending', 'in_progress', 'done', 'needs_reassessment'])
          .optional()
          .describe('按状态过滤'),
      },
    },
    withCore(core, actor, (c, filter) => c.tasks.listTasks(filter)),
  );

  server.registerTool(
    'confirm_task_reassessment',
    {
      title: '确认任务重估',
      description:
        '需求点实质修改后其任务被打 needs_reassessment;人工/agent 确认重估后任务回到 pending 重新开发',
      inputSchema: { id: z.string().describe('任务 id') },
    },
    withCore(core, actor, (c, { id }) => c.tasks.confirmTaskReassessment(id, actor)),
  );
}
