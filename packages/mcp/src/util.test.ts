import { describe, expect, it } from 'vitest';
import { DomainError, type ShipmateCore } from '@shipmate/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { fail, ok, withCore } from './util.js';

/** content[0] 是联合类型,测试里统一窄化取 text 块 */
function text(result: CallToolResult): string {
  const block = result.content[0]!;
  if (!('text' in block)) throw new Error('首个 content 块不是 text');
  return block.text;
}

describe('ok', () => {
  it('对象序列化为两空格缩进 JSON 文本', () => {
    const result = ok({ id: 'a1', name: '分组' });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ id: 'a1', name: '分组' }, null, 2) },
    ]);
  });

  it('null 与数组也走 JSON 序列化', () => {
    expect(text(ok(null))).toBe('null');
    expect(text(ok([1, 2]))).toBe(JSON.stringify([1, 2], null, 2));
  });
});

describe('fail', () => {
  it('DomainError 映射为 "CODE: message"', () => {
    const result = fail(new DomainError('GROUP_NOT_EMPTY', '分组下仍有项目'));
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('GROUP_NOT_EMPTY: 分组下仍有项目');
  });

  it('普通 Error 映射为 INTERNAL', () => {
    const result = fail(new Error('boom'));
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('INTERNAL: boom');
  });

  it('非 Error 值同样得到 INTERNAL 文本', () => {
    const result = fail('异常字符串');
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('INTERNAL: 异常字符串');
  });
});

describe('withCore', () => {
  const fakeCore = {} as unknown as ShipmateCore;

  it('fn 正常返回值经 ok 序列化', async () => {
    const handler = withCore(fakeCore, 'mcp:test', async (_core, args: { id: string }) => ({
      id: args.id,
    }));
    const result = await handler({ id: 'x1' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(text(result))).toEqual({ id: 'x1' });
  });

  it('fn 抛 DomainError 时 isError 且含 code', async () => {
    const handler = withCore(fakeCore, 'mcp:test', async () => {
      throw new DomainError('NOT_FOUND', '项目不存在');
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('NOT_FOUND: 项目不存在');
  });

  it('fn 抛未知错误时映射 INTERNAL', async () => {
    const handler = withCore(fakeCore, 'mcp:test', async () => {
      throw new Error('数据库炸了');
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('INTERNAL: 数据库炸了');
  });

  it('actor 透传给 fn(审计记录用)', async () => {
    const seen: string[] = [];
    const handler = withCore(fakeCore, 'mcp:claude-code', async (_core, _args, actor) => {
      seen.push(actor);
      return actor;
    });
    const result = await handler({});
    expect(seen).toEqual(['mcp:claude-code']);
    expect(JSON.parse(text(result))).toBe('mcp:claude-code');
  });
});
