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
