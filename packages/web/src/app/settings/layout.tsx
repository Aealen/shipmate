import { getTranslations } from 'next-intl/server';
import { SettingsNav } from '@/components/settings/settings-nav';

/** 设置区壳:左侧二级导航(个人信息/模型设置/MCP 接入/系统信息/数据管理)+ 右侧内容 */
export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const t = await getTranslations('settings');

  return (
    <div className="mx-auto flex w-full max-w-5xl items-start gap-8 p-6">
      <SettingsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
