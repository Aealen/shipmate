import type { SVGProps } from 'react';

/**
 * 内联 SVG 图标集(lucide 风格 stroke,currentColor 随文字色)。
 * 不引图标库依赖;后续任务需要新图标在此追加。
 */
function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    />
  );
}

/** ShipMate 帆船标(侧栏左上角,点击循环折叠态) */
export function IconShip(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3c3.5 2.2 5.5 5.8 5.5 9.5H12z" />
      <path d="M12 3c-3 2.2-4.8 5.3-4.8 8.7H12z" />
      <path d="M12 3v9.5" />
      <path d="M3.5 16.5h17l-2.2 4H5.7z" />
    </Svg>
  );
}

export function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5" />
    </Svg>
  );
}

export function IconSettings(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </Svg>
  );
}

/** MCP 接入 */
export function IconPlug(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M9 7V3M15 7V3" />
      <path d="M7 7h10v3.5a5 5 0 0 1-10 0z" />
      <path d="M12 15.5V21" />
    </Svg>
  );
}

/** 侧栏展开(hidden 态时顶栏左侧) */
export function IconPanelLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16" />
    </Svg>
  );
}

export function IconSun(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}

export function IconMoon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </Svg>
  );
}

export function IconGlobe(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14.2 14.2 0 0 1 0 18 14.2 14.2 0 0 1 0-18z" />
    </Svg>
  );
}

export function IconLogOut(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </Svg>
  );
}

export function IconUser(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-3.8 5-5 8-5s6.5 1.2 8 5" />
    </Svg>
  );
}
