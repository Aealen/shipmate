'use server';

import { cookies } from 'next/headers';
import { defaultLocale, LOCALE_COOKIE, type Locale, isLocale } from './routing';

/** 读取用户 locale 偏好(cookie 持久化;无 cookie 时回落默认 zh-CN) */
export async function getUserLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return value && isLocale(value) ? value : defaultLocale;
}

/** 写入用户 locale 偏好(仅可在 server action / route handler 中调用) */
export async function setUserLocale(locale: Locale): Promise<void> {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}
