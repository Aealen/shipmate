import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DomainError, type Actor, type ShipmateCore } from '@shipmate/core';

/** 工具 handler 统一形态:入参为 zod 解析后的对象,返回 MCP CallToolResult */
export type ToolHandler<A = Record<string, unknown>> = (args: A) => Promise<CallToolResult>;

/** 成功返回:结果 JSON 序列化为唯一 text 块 */
export function ok(result: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

/** 失败返回:DomainError → "CODE: message";其余 → "INTERNAL: <message>" */
export function fail(e: unknown): CallToolResult {
  const text = e instanceof DomainError ? `${e.code}: ${e.message}` : `INTERNAL: ${textOf(e)}`;
  return { isError: true, content: [{ type: 'text', text }] };
}

function textOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 统一包装:handler 只做「调 core → 结果/错误序列化」,不写业务分支。
 * actor 由 createMcpServer 注入,经 fn 第三参透传(core 落审计用)。
 */
export function withCore<A extends Record<string, unknown>>(
  core: ShipmateCore,
  actor: Actor,
  fn: (core: ShipmateCore, args: A, actor: Actor) => Promise<unknown>,
): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return ok(await fn(core, args, actor));
    } catch (e) {
      return fail(e);
    }
  };
}
