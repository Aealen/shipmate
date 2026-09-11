import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import { newId } from './db/id.js';
import type { Actor } from './types.js';

describe('DomainError', () => {
  it('携带 code 与 details', () => {
    const e = new DomainError('GROUP_NOT_EMPTY', '分组下仍有项目', { projectId: 'p1' });
    expect(e.code).toBe('GROUP_NOT_EMPTY');
    expect(e.details).toEqual({ projectId: 'p1' });
    expect(e.message).toBe('分组下仍有项目');
    expect(e.name).toBe('DomainError');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('newId', () => {
  it('生成 UUID v7 且唯一', () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('Actor', () => {
  it('接受三种来源', () => {
    const actors: Actor[] = ['human', 'ai:analysis', 'mcp:claude-code'];
    expect(actors).toHaveLength(3);
  });
});
