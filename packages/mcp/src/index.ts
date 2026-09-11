import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCore, type Actor, type ShipmateDb } from '@shipmate/core';

/** actor 由服务器构造时确定:stdio 固定 mcp:claude-code;HTTP 按 clientInfo.name 推导 */
export function createMcpServer(db: ShipmateDb, actor: Actor): McpServer {
  const core = createCore(db);
  const server = new McpServer({ name: 'shipmate', version: '0.1.0' });
  // 领域工具组注册位:分组/项目、需求/需求点/任务、素材/分析、审计/进度由后续模块填充
  void core;
  void actor;
  return server;
}
