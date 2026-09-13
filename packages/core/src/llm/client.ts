import { DomainError } from '../errors.js';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
}

/** OpenAI 兼容 /chat/completions,JSON mode;失败明确报错不静默降级(spec §7 规则) */
export async function chatJson(cfg: LlmConfig, system: string, user: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: cfg.temperature ?? 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 120_000),
    });
  } catch (e) {
    throw new DomainError('LLM_ERROR', `LLM 请求失败:${(e as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DomainError('LLM_ERROR', `LLM 返回 ${res.status}:${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new DomainError('LLM_SCHEMA_MISMATCH', 'LLM 响应缺少 choices[0].message.content');
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new DomainError('LLM_SCHEMA_MISMATCH', 'LLM 返回内容不是合法 JSON');
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/**
 * chatJson 的流式版(原型 P3f3/P3f4:修订过程流式日志区):
 * 与 chatJson 同参数同错误映射,但走 stream:true 的 SSE——每条
 * `data: {...choices[0].delta.content...}` 增量经 handlers.onDelta(delta, full) 回调,
 * `data: [DONE]` 结束;结束后整体 JSON.parse 成功才返回,失败 LLM_SCHEMA_MISMATCH。
 * 用户中断(signal 触发)的 AbortError 原样 rethrow,由上层识别为取消,不包装成 LLM_ERROR。
 */
export async function chatJsonStream(
  cfg: LlmConfig,
  system: string,
  user: string,
  handlers: { onDelta?: (deltaText: string, fullText: string) => void; signal?: AbortSignal } = {},
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: cfg.temperature ?? 0.2,
        stream: true,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: handlers.signal ?? AbortSignal.timeout(cfg.timeoutMs ?? 120_000),
    });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new DomainError('LLM_ERROR', `LLM 请求失败:${(e as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DomainError('LLM_ERROR', `LLM 返回 ${res.status}:${body.slice(0, 300)}`);
  }
  if (!res.body) throw new DomainError('LLM_ERROR', 'LLM 流式响应缺少 body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';

  /** 处理一行 SSE:`data: {...}` 增量回调;返回是否收到 [DONE] */
  const handleLine = (rawLine: string): boolean => {
    const line = rawLine.replace(/\r$/, '');
    if (!line.startsWith('data:')) return false;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') return true;
    let evt: { choices?: { delta?: { content?: string } }[] };
    try {
      evt = JSON.parse(payload);
    } catch {
      return false; // 心跳/注释等非 JSON 行忽略
    }
    const delta = evt.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) {
      full += delta;
      handlers.onDelta?.(delta, full);
    }
    return false;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      let finished = false;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (handleLine(line)) {
          finished = true;
          break;
        }
      }
      if (finished) break;
    }
    // 流末尾可能残留无换行符的最后一行
    if (buf.length > 0) handleLine(buf);
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new DomainError('LLM_ERROR', `LLM 流式读取失败:${(e as Error).message}`);
  }

  try {
    return JSON.parse(full) as unknown;
  } catch {
    throw new DomainError('LLM_SCHEMA_MISMATCH', 'LLM 返回内容不是合法 JSON');
  }
}
