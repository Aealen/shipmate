import { redirect } from 'next/navigation';

/** /settings 默认落在个人信息页(侧栏「设置」入口指向 /settings/profile,此处兜底) */
export default function SettingsIndexPage() {
  redirect('/settings/profile');
}
