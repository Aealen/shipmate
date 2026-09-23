import { getTranslations } from 'next-intl/server';

/** P8 个人信息页:本机单用户工具,静态占位(与顶栏头像菜单身份一致) */
export default async function ProfileSettingsPage() {
  const t = await getTranslations('settings.profile');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[26px] font-bold tracking-tight text-text-primary">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('description')}</p>
      </header>

      <section className="rounded-lg bg-surface p-6 transition-shadow duration-[120ms] hover:shadow-sm">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-dim text-lg font-semibold text-accent">
            S
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">{t('name')}</p>
            <p className="mt-0.5 truncate text-xs text-text-muted">{t('email')}</p>
          </div>
          <span className="ml-auto inline-flex shrink-0 items-center rounded-full bg-accent-dim px-2 py-0.5 text-xs font-medium text-accent">
            {t('role')}
          </span>
        </div>
        <p className="mt-4 border-t border-border pt-4 text-xs leading-relaxed text-text-muted">
          {t('hint')}
        </p>
      </section>
    </div>
  );
}
