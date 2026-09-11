import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * next-intl 插件:默认读取 src/i18n/request.ts 的请求级配置(无 i18n 路由前缀模式)。
 */
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // monorepo:core / mcp 均以 TS 源码直出(exports 指向 src/*.ts),交给 Next 转译
  transpilePackages: ['@shipmate/core', '@shipmate/mcp'],
  // pg 必须按 Node 原生模块外部化,避免被打进 server bundle(core 的连接池依赖)
  serverExternalPackages: ['pg'],
};

export default withNextIntl(nextConfig);
