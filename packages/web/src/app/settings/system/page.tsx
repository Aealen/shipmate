import { CORE_VERSION } from '@shipmate/core';
import { getTranslations } from 'next-intl/server';
import { getShipmate } from '@/lib/core';
import webPackage from '../../../../package.json';

/** P8 系统信息页:版本(包/核心/Node)、服务地址、数据库连接态 */
export default async function SystemSettingsPage() {
  const t = await getTranslations('settings.system');

  // DB 连接态:getShipmate 失败(DB 未起/env 缺失等)明确展示错误,不静默
  let dbOk = true;
  let dbError = '';
  try {
    await getShipmate();
  } catch (e) {
    dbOk = false;
    dbError = e instanceof Error ? e.message : String(e);
  }

  const rows: { label: string; value: string }[] = [
    { label: t('webVersion'), value: webPackage.version },
    { label: t('coreVersion'), value: CORE_VERSION },
    { label: t('nodeVersion'), value: process.version },
    { label: t('endpoint'), value: t('endpointValue') },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[26px] font-bold tracking-tight text-text-primary">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('description')}</p>
      </header>

      <section className="rounded-lg bg-surface p-6 transition-shadow duration-[120ms] hover:shadow-sm">
        <dl className="divide-y divide-border">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
            >
              <dt className="shrink-0 text-xs text-text-muted">{row.label}</dt>
              <dd className="min-w-0 truncate font-mono text-xs text-text-primary">{row.value}</dd>
            </div>
          ))}

          {/* 数据库连接态 */}
          <div className="flex items-center justify-between gap-4 py-2.5 last:pb-0">
            <dt className="shrink-0 text-xs text-text-muted">{t('dbStatus')}</dt>
            <dd className="flex min-w-0 flex-col items-end gap-0.5">
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${
                  dbOk ? 'text-success' : 'text-danger'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${dbOk ? 'bg-success' : 'bg-danger'}`} />
                {dbOk ? t('dbConnected') : t('dbDisconnected')}
              </span>
              {!dbOk && dbError && (
                <span className="max-w-md break-words text-right text-xs text-text-muted">
                  {dbError}
                </span>
              )}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
