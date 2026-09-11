import { getTranslations } from 'next-intl/server';
import { getSettings } from '@/actions/settings';
import { ModelForm, type ModelFormInitial } from '@/components/settings/model-form';

/** 从 settings 全量键值提取表单初值;DB 未起等故障降级为全空表单 */
function toInitial(all: Record<string, unknown>): ModelFormInitial {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown) => (typeof v === 'number' ? String(v) : '');
  return {
    baseUrl: str(all['llm.base_url']),
    apiKey: str(all['llm.api_key']),
    model: str(all['llm.model']),
    temperature: num(all['llm.temperature']),
    timeoutMs: num(all['llm.timeout_ms']),
  };
}

/** P8 模型设置页:LLM 接入参数表单(spec §10,落 settings 表 + 连接测试) */
export default async function ModelSettingsPage() {
  const t = await getTranslations('settings.model');
  const all = await getSettings().catch(() => ({}) as Record<string, unknown>);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-text-primary">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('description')}</p>
      </header>
      <ModelForm initial={toInitial(all)} />
    </div>
  );
}
