import { createMcpHttpHandler } from '@shipmate/mcp';
import { getShipmate } from '@/lib/core';

/**
 * MCP HTTP 端点(spec §10 :47610/api/mcp)—— 挂载 @shipmate/mcp 的 streamable handler。
 *
 * - 会话状态(sessions Map)保存在 handler 闭包内,与 Next.js route module 同生命周期;
 *   故 handler 仅构造一次,经 Promise 缓存。
 * - force-dynamic:禁止 build 时静态求值 GET(DB 未起时 build 会失败)。
 * - DB/env 未就绪时 getShipmate() 抛错,这里转 JSON-RPC 500(失败不缓存,可重试)。
 */
export const dynamic = 'force-dynamic';

let handlerPromise: Promise<(request: Request) => Promise<Response>> | undefined;

function getHandler() {
  handlerPromise ??= getShipmate()
    .then((shipmate) => createMcpHttpHandler(shipmate.db))
    .catch((e) => {
      handlerPromise = undefined;
      throw e;
    });
  return handlerPromise;
}

async function dispatch(request: Request): Promise<Response> {
  try {
    return await (
      await getHandler()
    )(request);
  } catch (e) {
    return Response.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: `MCP 服务不可用:${e instanceof Error ? e.message : String(e)}`,
        },
        id: null,
      },
      { status: 500 },
    );
  }
}

export const POST = dispatch;
export const GET = dispatch;
export const DELETE = dispatch;
