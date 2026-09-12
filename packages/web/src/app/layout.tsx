import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { getHomeOverview } from '@/actions/projects';
import { Sidebar } from '@/components/layout/sidebar';
import { SidebarModeProvider } from '@/components/layout/sidebar-state';
import { Topbar } from '@/components/layout/topbar';
import { ThemeProvider } from '@/components/theme-provider';
import { ToastHost } from '@/components/shared/toast';
import './globals.css';

// 本机单用户工具:全站动态渲染(侧栏项目列表为实时数据,也避免 build 期依赖 DB)
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return { title: t('appName'), description: 'ShipMate —— 需求分析与任务管理' };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();

  // 侧栏数据取数失败(DB 未起等)不阻塞壳渲染,降级为空列表
  const overview = await getHomeOverview().catch(() => ({
    groups: [],
    grouped: [],
    ungrouped: [],
  }));

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="bg-bg text-text-primary antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <NextIntlClientProvider messages={messages}>
            <SidebarModeProvider>
              {/* 壳对齐原型:顶栏全宽横跨(Logo 最左),侧栏在顶栏下方 */}
              <div className="flex h-screen flex-col overflow-hidden">
                <Topbar />
                <div className="flex min-h-0 flex-1">
                  <Sidebar overview={overview} />
                  <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
                </div>
              </div>
              <ToastHost />
            </SidebarModeProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
