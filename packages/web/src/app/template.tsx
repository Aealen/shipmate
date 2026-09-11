/**
 * 路由切换时重新挂载,驱动 spec §14 的页面过渡:淡入 + 8px 上移 120ms
 * (动画定义见 globals.css .page-enter)。
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter h-full">{children}</div>;
}
