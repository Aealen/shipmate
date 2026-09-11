'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { saveSettingsAction, testLlmConnectionAction } from '@/actions/settings';
import { showToast } from '@/components/shared/toast';

/** 表单回显初值(服务端从 settings 表读出,数字转字符串) */
export interface ModelFormInitial {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: string;
  timeoutMs: string;
}

const INPUT_CLASS =
  'h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent';

/**
 * P8 模型设置表单:base_url / api_key(密文)/ model / temperature / timeout_ms
 * → saveSettingsAction 落 settings 表(spec §10:改后即时生效,无需重启)。
 * 「测试连接」以当前表单值为准:先保存再发最小 JSON 请求,成功/失败均 toast。
 */
export function ModelForm({ initial }: { initial: ModelFormInitial }) {
  const t = useTranslations('settings.model');
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [model, setModel] = useState(initial.model);
  const [temperature, setTemperature] = useState(initial.temperature);
  const [timeoutMs, setTimeoutMs] = useState(initial.timeoutMs);
  const [isSaving, startSave] = useTransition();
  const [isTesting, startTest] = useTransition();

  /** 组装写入 payload;数字字段留空则跳过(保留旧值,对应 getLlmConfig 的可选语义) */
  const buildPayload = (): Record<string, unknown> => {
    const entries: Record<string, unknown> = {
      'llm.base_url': baseUrl.trim(),
      'llm.api_key': apiKey.trim(),
      'llm.model': model.trim(),
    };
    const temp = Number(temperature);
    if (temperature.trim() !== '' && Number.isFinite(temp)) entries['llm.temperature'] = temp;
    const timeout = Number(timeoutMs);
    if (timeoutMs.trim() !== '' && Number.isFinite(timeout) && timeout > 0) {
      entries['llm.timeout_ms'] = timeout;
    }
    return entries;
  };

  const validate = (): boolean => {
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      showToast(t('missingRequired'), 'error');
      return false;
    }
    return true;
  };

  const handleSave = () => {
    if (!validate()) return;
    startSave(async () => {
      const res = await saveSettingsAction(buildPayload());
      showToast(res.ok ? t('saveSuccess') : res.message, res.ok ? 'success' : 'error');
    });
  };

  const handleTest = () => {
    if (!validate()) return;
    startTest(async () => {
      // 测试按表单当前值:先保存(即时生效语义)再连,避免「测的是旧配置」的困惑
      const saved = await saveSettingsAction(buildPayload());
      if (!saved.ok) {
        showToast(saved.message, 'error');
        return;
      }
      const res = await testLlmConnectionAction();
      showToast(
        res.ok ? t('testSuccess', { model: res.model }) : res.message,
        res.ok ? 'success' : 'error',
      );
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
      className="space-y-4"
    >
      <div className="space-y-4 rounded-xl border border-border bg-surface p-5 transition-colors duration-[120ms] hover:border-accent">
        <Field label={t('baseUrl')}>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            autoComplete="off"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label={t('apiKey')} hint={t('apiKeyHint')}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            autoComplete="new-password"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label={t('model')}>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="deepseek-chat / gpt-4o / …"
            autoComplete="off"
            className={INPUT_CLASS}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('temperature')}>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="0.2"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('timeout')}>
            <input
              type="number"
              min={1}
              step={1000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(e.target.value)}
              placeholder="120000"
              className={INPUT_CLASS}
            />
          </Field>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isSaving || isTesting}
          className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-white transition-[transform,opacity] duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? t('saving') : t('save')}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={isSaving || isTesting}
          className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm text-text-secondary transition-[transform,border-color,color] duration-[80ms] hover:border-accent hover:text-accent active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isTesting ? t('testing') : t('test')}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-text-muted">{hint}</span>}
    </label>
  );
}
