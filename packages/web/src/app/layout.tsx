import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return { title: t('appName'), description: 'ShipMate —— 需求分析与任务管理' };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="bg-bg text-text-primary antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
