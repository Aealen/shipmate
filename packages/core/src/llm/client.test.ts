import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../errors.js';
import { chatJson } from './client.js';
import { analysisResultSchema, type AnalysisResult } from './schema.js';
import { buildUserPrompt } from './prompt.js';
import type { MaterialRow } from '../db/schema.js';

const cfg = { baseUrl: 'https://api.test/v1', apiKey: 'sk-test', model: 'm' };

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('chatJson', () => {
  it('正常返回解析后的 JSON;请求带 json_object 模式与鉴权头', async () => {
    const fn = mockFetchOnce(200, { choices: [{ message: { content: '{"ok":true}' } }] });
    const out = await chatJson(cfg, 'sys', 'usr');
    expect(out).toEqual({ ok: true });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.model).toBe('m');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('baseUrl 结尾斜杠被归一', async () => {
    const fn = mockFetchOnce(200, { choices: [{ message: { content: '{}' } }] });
    await chatJson({ ...cfg, baseUrl: 'https://api.test/v1///' }, 's', 'u');
    expect((fn.mock.calls[0] as unknown[])[0]).toBe('https://api.test/v1/chat/completions');
  });

  it('HTTP 500 → LLM_ERROR', async () => {
    mockFetchOnce(500, { error: 'boom' });
    try {
      await chatJson(cfg, 's', 'u');
      expect.unreachable();
    } catch (e) {
      expect((e as DomainError).code).toBe('LLM_ERROR');
    }
  });

  it('content 非法 JSON → LLM_SCHEMA_MISMATCH', async () => {
    mockFetchOnce(200, { choices: [{ message: { content: '不是json' } }] });
    try {
      await chatJson(cfg, 's', 'u');
      expect.unreachable();
    } catch (e) {
      expect((e as DomainError).code).toBe('LLM_SCHEMA_MISMATCH');
    }
  });
});

describe('analysisResultSchema', () => {
  it('接受完整结构并补默认值', () => {
    const parsed = analysisResultSchema.parse({
      requirements: [
        {
          title: '导出',
          points: [
            {
              title: 'CSV',
              confidence: 0.9,
              evidences: [{ material_id: 'm1', quote: '要能导出' }],
            },
          ],
        },
      ],
      supplements: [],
    }) as AnalysisResult;
    expect(parsed.requirements[0]!.summary).toBe('');
    expect(parsed.requirements[0]!.conflict).toBeUndefined();
  });

  it('拒绝缺 evidences 字段的点', () => {
    expect(() =>
      analysisResultSchema.parse({
        requirements: [{ title: 'x', points: [{ title: 'p', confidence: 1 }] }],
        supplements: [],
      }),
    ).toThrow();
  });
});

describe('buildUserPrompt', () => {
  it('拼接素材与已有需求摘要', () => {
    const mat = {
      id: 'm1',
      type: 'paste_text',
      title: '会议记录',
      rawContent: '要能导出 CSV',
    } as MaterialRow;
    const text = buildUserPrompt(
      [mat],
      [
        {
          id: 'r1',
          title: '已有需求',
          summary: '摘要',
          points: [{ id: 'p1', title: '点A', status: 'done' }],
        },
      ],
    );
    expect(text).toContain('【素材 m1】');
    expect(text).toContain('要能导出 CSV');
    expect(text).toContain('已有需求');
    expect(text).toContain('点A');
  });
});
