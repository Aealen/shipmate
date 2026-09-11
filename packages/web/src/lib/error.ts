import { DomainError } from '@shipmate/core';

/**
 * 写操作统一返回结构:message 为 core 抛出的中文原文(spec §7:
 * DomainError.message 即面向用户文案),UI 直接用于 toast,不再二次加工。
 */
export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; code: string; message: string };

/** DomainError → { code, message };非 DomainError 兜底为 INTERNAL 并留服务端日志 */
export function toActionError(e: unknown): { ok: false; code: string; message: string } {
  if (e instanceof DomainError) {
    return { ok: false, code: e.code, message: e.message };
  }
  console.error('[action] 未预期错误:', e);
  return {
    ok: false,
    code: 'INTERNAL',
    message: e instanceof Error ? e.message : '服务内部错误,请稍后重试',
  };
}
