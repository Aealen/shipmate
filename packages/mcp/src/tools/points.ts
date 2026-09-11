import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Actor, ShipmateCore } from '@shipmate/core';
import { withCore } from '../util.js';

export function registerPointTools(server: McpServer, core: ShipmateCore, actor: Actor): void {
  server.registerTool(
    'list_requirement_points',
    {
      title: '列出需求点',
      description: '列出需求点,可按需求/项目/状态过滤',
      inputSchema: {
        requirementId: z.string().optional().describe('按需求 id 过滤'),
        projectId: z.string().optional().describe('按项目 id 过滤'),
        status: z
          .enum(['draft', 'confirmed', 'developing', 'done'])
          .optional()
          .describe('按状态过滤'),
      },
    },
    withCore(core, actor, (c, filter) => c.points.listRequirementPoints(filter)),
  );

  server.registerTool(
    'get_requirement_point',
    {
      title: '查询需求点',
      description: '查询单个需求点详情:点本体 + 关联任务 + 完整变更历史 + evidences 溯源',
      inputSchema: { id: z.string().describe('需求点 id') },
    },
    withCore(core, actor, (c, { id }) => c.points.getRequirementPoint(id)),
  );

  server.registerTool(
    'update_requirement_point',
    {
      title: '修改需求点',
      description:
        '实质修改需求点标题/描述:版本 +1;developing/done 自动回退 confirmed;其下全部任务联动打 needs_reassessment,返回 affectedTaskCount',
      inputSchema: {
        id: z.string().describe('需求点 id'),
        title: z.string().optional().describe('新标题'),
        description: z.string().optional().describe('新描述'),
        reason: z.string().optional().describe('修改原因,记入变更历史'),
      },
    },
    withCore(core, actor, (c, { id, ...input }) =>
      c.points.updateRequirementPoint(id, input, actor),
    ),
  );

  server.registerTool(
    'set_requirement_point_status',
    {
      title: '流转需求点状态',
      description:
        '按状态机流转需求点:confirm(draft→confirmed)、start(confirmed→developing)、complete(developing→done);非法流转返回 INVALID_STATUS_TRANSITION',
      inputSchema: {
        id: z.string().describe('需求点 id'),
        action: z.enum(['confirm', 'start', 'complete']).describe('流转动作'),
      },
    },
    withCore(core, actor, (c, { id, action }) =>
      c.points.setRequirementPointStatus(id, action, actor),
    ),
  );

  server.registerTool(
    'confirm_requirement_point',
    {
      title: '确认需求点',
      description: '确认需求点(draft→confirmed)的语义化别名,供 AI 直接表达「确认」意图',
      inputSchema: { id: z.string().describe('需求点 id') },
    },
    withCore(core, actor, (c, { id }) => c.points.confirmRequirementPoint(id, actor)),
  );
}
