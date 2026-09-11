import { NextResponse } from 'next/server';

/**
 * MCP HTTP 端点(spec §10::47610/api/mcp)—— 占位实现。
 *
 * 待 packages/mcp(Plan 2,另一工程师并行实现中)发布 `createMcpHttpHandler(db)` 导出后接通:
 *   import { createMcpHttpHandler } from '@shipmate/mcp';
 *   import { getShipmate } from '@/lib/core';
 *   const shipmate = await getShipmate();
 *   export const POST  = createMcpHttpHandler(shipmate.db);
 *   export const GET   = createMcpHttpHandler(shipmate.db);
 *   export const DELETE = createMcpHttpHandler(shipmate.db);
 *
 * 在那之前,本路由返回 503,不阻塞 web 基建。
 */
const NOT_READY = { error: 'MCP 服务尚未接入:等待 @shipmate/mcp 包就绪' };

export async function POST() {
  return NextResponse.json(NOT_READY, { status: 503 });
}

export async function GET() {
  return NextResponse.json(NOT_READY, { status: 503 });
}

export async function DELETE() {
  return NextResponse.json(NOT_READY, { status: 503 });
}
