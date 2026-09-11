import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDatabase, loadDotEnv } from '@shipmate/core';
import { createMcpServer } from './index.js';

// stdio 入口:stdout 是协议通道,日志一律走 stderr
loadDotEnv();
const url = process.env.SHIPMATE_DATABASE_URL;
if (!url) throw new Error('缺少 SHIPMATE_DATABASE_URL(见仓库根 .env)');
const db = await createDatabase(url);
const server = createMcpServer(db, 'mcp:claude-code');
await server.connect(new StdioServerTransport());
console.error('shipmate-mcp stdio ready');
