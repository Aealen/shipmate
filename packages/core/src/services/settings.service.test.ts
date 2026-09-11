import { describe, expect, it } from 'vitest';
import { withDb } from '../db/database.js';
import { DomainError } from '../errors.js';
import { SettingsService } from './settings.service.js';

describe('SettingsService', () => {
  it('set/get 往返(对象值 jsonb 序列化);get 不存在返回 undefined', async () => {
    await withDb(async (db) => {
      const svc = new SettingsService(db);
      await svc.set('ui.theme', 'dark');
      await svc.set('llm.temperature', 0.3);
      await svc.set('some.obj', { a: [1, 2] });
      expect(await svc.get<string>('ui.theme')).toBe('dark');
      expect(await svc.get<number>('llm.temperature')).toBe(0.3);
      expect(await svc.get<{ a: number[] }>('some.obj')).toEqual({ a: [1, 2] });
      expect(await svc.get('missing')).toBeUndefined();
    });
  });

  it('set 覆盖旧值(upsert);getOrThrow 缺失抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const svc = new SettingsService(db);
      await svc.set('k', 1);
      await svc.set('k', 2);
      expect(await svc.get('k')).toBe(2);
      try {
        await svc.getOrThrow('nope');
        expect.unreachable('应当抛错');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  it('getLlmConfig:三项齐才通过,缺一抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const svc = new SettingsService(db);
      await svc.set('llm.base_url', 'https://api.example.com/v1');
      await svc.set('llm.api_key', 'sk-test-placeholder');
      try {
        await svc.getLlmConfig();
        expect.unreachable('应当抛错');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
      await svc.set('llm.model', 'gpt-test');
      const cfg = await svc.getLlmConfig();
      expect(cfg).toEqual({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test-placeholder',
        model: 'gpt-test',
        temperature: undefined,
        timeoutMs: undefined,
      });
    });
  });

  it('ensureSeededFromEnv:仅首播种,settings 已有值不覆盖', async () => {
    await withDb(async (db) => {
      const svc = new SettingsService(db);
      const env = { SHIPMATE_LLM_BASE_URL: 'https://env.example.com/v1', SHIPMATE_LLM_API_KEY: 'sk-env', SHIPMATE_LLM_MODEL: 'm1' };
      await svc.ensureSeededFromEnv(env as NodeJS.ProcessEnv);
      expect(await svc.get('llm.base_url')).toBe('https://env.example.com/v1');
      // settings 已有值时 env 不覆盖
      await svc.set('llm.base_url', 'https://manual.example.com/v1');
      await svc.ensureSeededFromEnv(env as NodeJS.ProcessEnv);
      expect(await svc.get('llm.base_url')).toBe('https://manual.example.com/v1');
    });
  });
});
