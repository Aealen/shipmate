import { getRequestConfig } from 'next-intl/server';
import { getUserLocale } from './locale';
import { defaultLocale, isLocale } from './routing';

/**
 * next-intl 请求级配置(无 i18n 路由前缀模式):
 * 每次 SSR 请求按 cookie 解析 locale 并加载对应 messages。
 */
export default getRequestConfig(async () => {
  const requested = await getUserLocale();
  const locale = isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
