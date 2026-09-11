import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Actor, ShipmateDb } from '@shipmate/core';
import { createMcpServer } from './index.js';

/** 测试注入的 actor,便于断言审计记录 */
export const TEST_ACTOR: Actor = 'mcp:test';

/** InMemoryTransport 成对连接:client 经协议层真正走一遍工具调用 */
export async function setupServer(db: ShipmateDb, actor: Actor = TEST_ACTOR) {
  const server = createMcpServer(db, actor);
  const client = new Client({ name: 'vitest', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

/** 调工具并窄化出 text 块;isError 统一归一为 boolean */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; text: string }> {
  // callTool 返回是「标准结果 | toolResult」联合,显式按标准 CallToolResultSchema 结果收窄
  const result = (await client.callTool(
    { name, arguments: args },
    CallToolResultSchema,
  )) as CallToolResult;
  const block = result.content[0];
  if (!block || !('text' in block)) throw new Error(`工具 ${name} 未返回 text 块`);
  return { isError: result.isError === true, text: block.text };
}
