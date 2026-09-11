import { revalidatePath } from 'next/cache';

/**
 * 全应用缓存刷新:写操作后统一调用。
 * 本机单用户工具,不做细粒度路径失效;('layout') 递归失效根布局下全部路由,
 * 防动态段(/project/[id]/…)与侧栏数据漏刷。
 */
export function revalidateApp(): void {
  revalidatePath('/', 'layout');
}
