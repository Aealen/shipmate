import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Actor, ShipmateCore } from '@shipmate/core';
import { withCore } from '../util.js';

export function registerRequirementTools(
  server: McpServer,
  core: ShipmateCore,
  actor: Actor,
): void {
  server.registerTool(
    'create_requirement',
    {
      title: '创建需求',
      description: '在项目下创建需求,默认 draft 态、P2 优先级;时间为 Unix 毫秒时间戳',
      inputSchema: {
        projectId: z.string().describe('所属项目 id'),
        title: z.string().describe('需求标题'),
        summary: z.string().optional().describe('需求摘要'),
        priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('优先级,缺省 P2'),
        planStartAt: z.number().int().optional().describe('计划开始时间(Unix 毫秒)'),
        planDueAt: z.number().int().optional().describe('计划到期时间(Unix 毫秒)'),
      },
    },
    withCore(core, actor, (c, args) => c.requirements.createRequirement(args, actor)),
  );

  server.registerTool(
    'update_requirement',
    {
      title: '更新需求',
      description:
        '修改需求标题/摘要/状态/优先级/计划时间;时间为 Unix 毫秒,传 null 清空;状态变化记审计',
      inputSchema: {
        id: z.string().describe('需求 id'),
        title: z.string().optional().describe('新标题'),
        summary: z.string().optional().describe('新摘要'),
        status: z.enum(['draft', 'confirmed', 'done', 'archived']).optional().describe('需求状态'),
        priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('优先级'),
        planStartAt: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe('计划开始(Unix 毫秒,null 清空)'),
        planDueAt: z.number().int().nullable().optional().describe('计划到期(Unix 毫秒,null 清空)'),
      },
    },
    withCore(core, actor, (c, { id, ...patch }) =>
      c.requirements.updateRequirement(id, patch, actor),
    ),
  );

  server.registerTool(
    'list_requirements',
    {
      title: '列出需求',
      description:
        '列出项目下需求,每项含 overdue/overdueDays/dueSoon 计算字段;可按状态/优先级/是否超期过滤',
      inputSchema: {
        projectId: z.string().describe('项目 id'),
        status: z.string().optional().describe('按状态过滤(draft/confirmed/done/archived)'),
        priority: z.string().optional().describe('按优先级过滤(P0/P1/P2/P3)'),
        overdue: z.boolean().optional().describe('传 true 仅返回超期需求'),
      },
    },
    withCore(core, actor, (c, { projectId, ...filter }) =>
      c.requirements.listRequirements(projectId, filter),
    ),
  );
}
