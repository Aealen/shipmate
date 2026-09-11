'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/** next-themes 客户端包装:class 策略,默认 light(见 app/layout.tsx) */
export function ThemeProvider(props: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
