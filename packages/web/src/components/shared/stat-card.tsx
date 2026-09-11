/**
 * 概览统计卡:白底圆角边框,hover 边框 accent 120ms(spec §14)。
 * 纯展示组件,颜色全走 CSS 变量,无需客户端指令。
 */
export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 transition-colors duration-[120ms] hover:border-accent">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-text-primary">{value}</p>
      {hint && <p className="mt-1 text-xs text-text-secondary">{hint}</p>}
    </div>
  );
}
