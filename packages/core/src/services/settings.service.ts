import { eq } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import { settings } from '../db/schema.js';
import { DomainError } from '../errors.js';
import type { LlmConfig } from '../llm/client.js';

export class SettingsService {
  constructor(private db: ShipmateDb) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = (await this.db.select().from(settings).where(eq(settings.key, key)))[0];
    return row ? (row.value as T) : undefined;
  }

  async getOrThrow<T = unknown>(key: string, message?: string): Promise<T> {
    const v = await this.get<T>(key);
    if (v === undefined)
      throw new DomainError('VALIDATION_ERROR', message ?? `配置项 ${key} 未设置`);
    return v;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value: value as never, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: value as never, updatedAt: Date.now() },
      });
  }

  async setMany(entries: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(entries)) await this.set(k, v);
  }

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(settings);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** spec §10:LLM 接入参数,每次现读(设置页改后即时生效);配置不齐明确报错,不静默降级 */
  async getLlmConfig(): Promise<LlmConfig> {
    const baseUrl = await this.get<string>('llm.base_url');
    const apiKey = await this.get<string>('llm.api_key');
    const model = await this.get<string>('llm.model');
    if (!baseUrl || !apiKey || !model) {
      throw new DomainError(
        'VALIDATION_ERROR',
        '模型未配置:请在「设置 → 模型设置」完成 base_url / api_key / model',
      );
    }
    return {
      baseUrl,
      apiKey,
      model,
      temperature: await this.get<number>('llm.temperature'),
      timeoutMs: await this.get<number>('llm.timeout_ms'),
    };
  }

  /** spec §10:env 仅作首次启动默认值;settings 已存在的 key 不覆盖 */
  async ensureSeededFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    const mapping: [string, string | undefined][] = [
      ['llm.base_url', env.SHIPMATE_LLM_BASE_URL],
      ['llm.api_key', env.SHIPMATE_LLM_API_KEY],
      ['llm.model', env.SHIPMATE_LLM_MODEL],
    ];
    for (const [key, val] of mapping) {
      if (val && (await this.get(key)) === undefined) await this.set(key, val);
    }
  }
}
