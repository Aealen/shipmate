import { getTranslations } from 'next-intl/server';

/** P1 项目首页占位(Task 4 落地真实页面) */
export default async function HomePage() {
  const t = await getTranslations('home');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-2xl font-semibold text-text-primary">{t('placeholderTitle')}</h1>
      <p className="text-sm text-text-secondary">{t('placeholderDesc')}</p>
    </main>
  );
}
