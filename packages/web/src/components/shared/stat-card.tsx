/**
 * 统计卡(对齐原型 P2/P6 帧):白底圆角无边框,数值 20px bold(可配色)+
 * 标签 11px 灰,hover 边框 accent 120ms(spec §14)。纯展示组件,无需客户端指令。
 */
export function StatCard({
  label,
  value,
  valueClassName = 'text-text-primary',
  hint,
}: {
  label: string;
  value: string | number;
  /** 数值颜色:普通 #1A1D23 / 已确认 accent / 警示 warning / 危险 danger 等 token 类 */
  valueClassName?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[10px] border border-border bg-surface p-3.5 transition-colors duration-[120ms] hover:border-accent">
      <p className="text-xl font-bold tabular-nums leading-tight">
        <span className={valueClassName}>{value}</span>
      </p>
      <p className="text-[11px] leading-none text-text-muted">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">{hint}</p>}
    </div>
  );
}
