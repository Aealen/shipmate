import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Actor, ShipmateDb } from '@shipmate/core';
import { createMcpServer } from './index.js';

/** 单个 MCP 会话:独立 server(actor 固化)+ 独立 transport */
interface McpSession {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

/** initialize 帧判定(外层轻解析,只读不改写;SDK 内部消费原始 parsedBody) */
function isInitializeFrame(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { method?: unknown }).method === 'initialize'
  );
}

/** spec §5.1:actor 从 clientInfo.name 推导 → mcp:<name>,缺省 mcp:unknown */
function deriveActor(body: unknown): Actor {
  const name = (body as { params?: { clientInfo?: { name?: unknown } } }).params?.clientInfo?.name;
  return typeof name === 'string' && name.trim() ? `mcp:${name.trim()}` : 'mcp:unknown';
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return jsonResponse(status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

/**
 * Web 标准 streamable HTTP handler(由 web 包挂载到 /api/mcp):
 * - 每个会话一个 transport + server;actor 在 initialize 时从 clientInfo.name 推导并固化
 * - 会话按 mcp-session-id 管理;DELETE 关闭并回收
 * - enableJsonResponse:工具调用均为请求-响应模式,JSON 响应避免 Next.js 路由内维护 SSE 长流
 */
export function createMcpHttpHandler(db: ShipmateDb): (request: Request) => Promise<Response> {
  const sessions = new Map<string, McpSession>();

  async function openSession(request: Request, body: unknown): Promise<Response> {
    const session = {} as McpSession;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, session);
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
      },
    });
    session.transport = transport;
    session.server = createMcpServer(db, deriveActor(body));
    await session.server.connect(transport);
    return transport.handleRequest(request, { parsedBody: body });
  }

  return async (request) => {
    if (request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonRpcError(400, -32700, 'Parse error: request body is not valid JSON');
      }
      const sessionId = request.headers.get('mcp-session-id');
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) return jsonRpcError(404, -32001, 'Session not found');
        return session.transport.handleRequest(request, { parsedBody: body });
      }
      if (isInitializeFrame(body)) return openSession(request, body);
      return jsonRpcError(400, -32600, 'Bad Request: missing mcp-session-id');
    }

    if (request.method === 'GET' || request.method === 'DELETE') {
      const sessionId = request.headers.get('mcp-session-id');
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) return jsonRpcError(404, -32001, 'Session not found');
      return session.transport.handleRequest(request);
    }

    return jsonRpcError(405, -32001, 'Method not allowed');
  };
}
