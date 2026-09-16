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

  server.registerTool(
    'revise_point',
    {
      title: 'AI 修订需求点',
      description:
        '按修订批注让 LLM 重写已落库需求点的标题/描述:实质修改时版本 +1、任务联动待重估,审计以 revision 类型留痕(批注即理由);LLM 失败零改动',
      inputSchema: {
        id: z.string().describe('需求点 id'),
        annotation: z.string().describe('修订批注,描述要怎么改'),
      },
    },
    withCore(core, actor, (c, { id, annotation }) =>
      c.analysis.revisePoint(id, annotation, actor),
    ),
  );

  server.registerTool(
    'delete_requirement_point',
    {
      title: '删除需求点',
      description:
        '删除需求点并级联删除其下全部任务,delete 快照留痕;不可恢复(仅审计可查)',
      inputSchema: { id: z.string().describe('需求点 id') },
    },
    withCore(core, actor, (c, { id }) => c.points.deleteRequirementPoint(id, actor)),
  );

  server.registerTool(
    'merge_requirement_points',
    {
      title: '合并需求点',
      description:
        '把多个需求点合并为一个:在目标需求下新建合并点(evidences 汇总),被并点及其任务删除留痕;同一事务,至少 2 个点且须同项目',
      inputSchema: {
        pointIds: z.array(z.string()).min(2).describe('被合并的需求点 id 列表(≥2,同项目)'),
        requirementId: z.string().describe('合并后归属的目标需求 id'),
        title: z.string().describe('合并后标题'),
        description: z.string().optional().describe('合并后描述'),
      },
    },
    withCore(core, actor, (c, { pointIds, ...target }) =>
      c.points.mergeRequirementPoints(pointIds, target, actor),
    ),
  );

  server.registerTool(
    'suggest_point_merge',
    {
      title: '智能合并建议',
      description:
        '按所选需求点让 LLM 生成合并后的标题/描述建议(不落库),供确认前二次编辑;至少 2 个点',
      inputSchema: {
        pointIds: z.array(z.string()).min(2).describe('待合并的需求点 id 列表(≥2)'),
      },
    },
    withCore(core, actor, (c, { pointIds }) => c.analysis.suggestPointMerge(pointIds, actor)),
  );
}
