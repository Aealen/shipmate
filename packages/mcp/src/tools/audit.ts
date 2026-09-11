import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Actor, ShipmateCore } from '@shipmate/core';
import { withCore } from '../util.js';

const ENTITY_TYPES = [
  'group',
  'project',
  'analysis_run',
  'material',
  'requirement',
  'requirement_point',
  'task',
] as const;

export function registerAuditTools(server: McpServer, core: ShipmateCore, actor: Actor): void {
  server.registerTool(
    'get_change_log',
    {
      title: '查询变更历史',
      description: '查询单个实体的变更时间线(按时间倒序),可限制条数',
      inputSchema: {
        entityType: z.enum(ENTITY_TYPES).describe('实体类型'),
        entityId: z.string().describe('实体 id'),
        limit: z.number().int().optional().describe('最多返回条数,缺省 100'),
      },
    },
    withCore(core, actor, (c, { entityType, entityId, limit }) =>
      c.audit.getChangeLog(
        limit === undefined ? { entityType, entityId } : { entityType, entityId, limit },
      ),
    ),
  );

  server.registerTool(
    'get_project_audit_report',
    {
      title: '项目审计报告',
      description:
        '项目全量审计:变更时间线 + actor 分布(human/ai/mcp)+ 实体类型分布 + 每日变更计数趋势',
      inputSchema: { projectId: z.string().describe('项目 id') },
    },
    withCore(core, actor, (c, { projectId }) => c.audit.getProjectAuditReport(projectId)),
  );

  server.registerTool(
    'get_project_progress',
    {
      title: '项目进度概要',
      description:
        '项目进度即项目概要:需求完成度、需求点状态分布、超期需求数与最近 20 条变更;无需单独的进度计算',
      inputSchema: { projectId: z.string().describe('项目 id') },
    },
    withCore(core, actor, (c, { projectId }) => c.projects.getProject(projectId)),
  );
}
