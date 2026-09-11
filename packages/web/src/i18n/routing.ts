/**
 * i18n 基础路由配置(next-intl「无 i18n 路由前缀」模式):
 * locale 不体现在 URL 中,zh-CN 为默认;en 预留。
 * 用户偏好经 cookie 持久化(见 ./locale.ts)。
 */
export const locales = ['zh-CN', 'en'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'zh-CN';

export const LOCALE_COOKIE = 'SHIPMATE_LOCALE';

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
