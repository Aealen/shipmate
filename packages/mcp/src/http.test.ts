import { describe, expect, it } from 'vitest';
import { createCore, withDb } from '@shipmate/core';
import { createMcpHttpHandler } from './http.js';

type Handler = ReturnType<typeof createMcpHttpHandler>;

/** 构造 JSON-RPC 帧 */
const initializeFrame = (clientName: string) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: clientName, version: '1.0.0' },
  },
});
const initializedFrame = { jsonrpc: '2.0', method: 'notifications/initialized' };
const listToolsFrame = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
const callFrame = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name, arguments: args },
});

async function post(handler: Handler, body: unknown, sessionId?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return handler(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
    }),
  );
}

/** 完成初始化握手,返回 sessionId */
async function handshake(handler: Handler, clientName: string): Promise<string> {
  const initRes = await post(handler, initializeFrame(clientName));
  expect(initRes.status).toBe(200);
  const initBody = (await initRes.json()) as {
    result: { serverInfo: { name: string; version: string } };
  };
  expect(initBody.result.serverInfo.name).toBe('shipmate');
  const sessionId = initRes.headers.get('mcp-session-id');
  expect(sessionId).toBeTruthy();
  const notified = await post(handler, initializedFrame, sessionId!);
  expect([202, 200]).toContain(notified.status);
  return sessionId!;
}

describe('MCP HTTP streamable handler', () => {
  it('initialize 握手返回 serverInfo 与 session id,tools/list 列全 34 个工具', async () => {
    await withDb(async (db) => {
      const handler = createMcpHttpHandler(db);
      const sessionId = await handshake(handler, 'claude-code');

      const listRes = await post(handler, listToolsFrame, sessionId);
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as { result: { tools: { name: string }[] } };
      const names = listBody.result.tools.map((t) => t.name).sort();
      expect(names).toHaveLength(34);
      // 抽样核对每组的代表工具
      expect(names).toContain('create_group');
      expect(names).toContain('add_material');
      expect(names).toContain('apply_analysis_run');
      expect(names).toContain('confirm_task_reassessment');
      expect(names).toContain('get_project_progress');
    });
  });

  it('actor 从 initialize 的 clientInfo.name 推导为 mcp:<name>', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const handler = createMcpHttpHandler(db);
      const sessionId = await handshake(handler, 'my-agent');

      const callRes = await post(handler, callFrame('create_group', { name: 'HTTP组' }), sessionId);
      expect(callRes.status).toBe(200);
      const callBody = (await callRes.json()) as { result: { content: { text: string }[] } };
      const created = JSON.parse(callBody.result.content[0]!.text);
      const logs = await core.audit.getChangeLog({
        entityType: 'group',
        entityId: created.id,
      });
      expect(logs[0]).toMatchObject({ actor: 'mcp:my-agent', changeType: 'create' });
    });
  });

  it('未带 session id 的非 initialize 请求返回 400,未知 session 返回 404', async () => {
    await withDb(async (db) => {
      const handler = createMcpHttpHandler(db);

      const noSession = await post(handler, listToolsFrame);
      expect(noSession.status).toBe(400);

      const ghost = await post(handler, listToolsFrame, 'ghost-session');
      expect(ghost.status).toBe(404);
    });
  });

  it('DELETE 关闭 session 后,后续请求 404', async () => {
    await withDb(async (db) => {
      const handler = createMcpHttpHandler(db);
      const sessionId = await handshake(handler, 'short-lived');

      const delRes = await handler(
        new Request('http://localhost/api/mcp', {
          method: 'DELETE',
          headers: { 'mcp-session-id': sessionId },
        }),
      );
      expect(delRes.status).toBe(200);

      const after = await post(handler, listToolsFrame, sessionId);
      expect(after.status).toBe(404);
    });
  });

  it('非法 JSON body 返回 400', async () => {
    await withDb(async (db) => {
      const handler = createMcpHttpHandler(db);
      const res = await handler(
        new Request('http://localhost/api/mcp', {
          method: 'POST',
          body: 'not-json',
          headers: { 'content-type': 'application/json' },
        }),
      );
      expect(res.status).toBe(400);
    });
  });
});
