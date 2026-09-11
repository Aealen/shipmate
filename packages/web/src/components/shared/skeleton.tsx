/**
 * 骨架屏:渐变底 + 呼吸动画(spec §14 分析结果区加载态)。
 * 末行短一截模拟段落节奏;纯展示组件,无需客户端指令。
 */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          style={{ width: lines > 1 && i === lines - 1 ? '60%' : '100%' }}
          className="h-4 animate-pulse rounded bg-linear-to-r from-surface-2 via-surface to-surface-2 [background-size:200%_100%]"
        />
      ))}
    </div>
  );
}
