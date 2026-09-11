import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCore, type Actor, type ShipmateDb } from '@shipmate/core';
import { registerGroupTools } from './tools/groups.js';
import { registerProjectTools } from './tools/projects.js';

/** actor 由服务器构造时确定:stdio 固定 mcp:claude-code;HTTP 按 clientInfo.name 推导 */
export function createMcpServer(db: ShipmateDb, actor: Actor): McpServer {
  const core = createCore(db);
  const server = new McpServer({ name: 'shipmate', version: '0.1.0' });
  registerGroupTools(server, core, actor);
  registerProjectTools(server, core, actor);
  return server;
}
