import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCore, type Actor, type ShipmateDb } from '@shipmate/core';
import { registerGroupTools } from './tools/groups.js';
import { registerProjectTools } from './tools/projects.js';
import { registerRequirementTools } from './tools/requirements.js';
import { registerPointTools } from './tools/points.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerAnalysisTools } from './tools/analysis.js';
import { registerAuditTools } from './tools/audit.js';

/** actor 由服务器构造时确定:stdio 固定 mcp:claude-code;HTTP 按 clientInfo.name 推导 */
export function createMcpServer(db: ShipmateDb, actor: Actor): McpServer {
  const core = createCore(db);
  const server = new McpServer({ name: 'shipmate', version: '0.1.0' });
  registerGroupTools(server, core, actor);
  registerProjectTools(server, core, actor);
  registerRequirementTools(server, core, actor);
  registerPointTools(server, core, actor);
  registerTaskTools(server, core, actor);
  registerAnalysisTools(server, core, actor);
  registerAuditTools(server, core, actor);
  return server;
}
