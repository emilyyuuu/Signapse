import type { CSSProperties, ReactNode } from "react";

// Brand artwork: the logo (public/logo.png),
// line icons, the iridescent orb, and concentric rings for waiting states.
// Decorative pieces are hidden from screen readers.

export function Logo({ size = 32, label }: { size?: number; label?: string }) {
  return (
    <img
      src="/logo.png"
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      style={{ borderRadius: size * 0.24, display: "block" }}
    />
  );
}

// Line icons, 24px grid, drawn in currentColor.
const ICONS = {
  chat: (
    <>
      <path d="M4 5h16v10H9l-5 4z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  body: (
    <>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M12 7v7M7 9.5l5-1.5 5 1.5M9.5 21l2.5-7 2.5 7" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" />
    </>
  ),
  pulse: <path d="M3 12h4l2-5 4 10 2-5h6" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  upright: <path d="M7 17L17 7M9 7h8v8" />,
  speaker: (
    <>
      <path d="M4 10v4h4l5 4V6L8 10z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  mute: (
    <>
      <path d="M4 10v4h4l5 4V6L8 10z" />
      <path d="M17 9l5 6M22 9l-5 6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1-3.5 4-5 7-5s6 1.5 7 5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  hands: (
    <>
      <path d="M8 13V6.5a1.3 1.3 0 0 1 2.6 0V12M10.6 11V5a1.3 1.3 0 0 1 2.6 0v6M13.2 11V6a1.3 1.3 0 0 1 2.6 0v7c0 4-2 7-5.5 7-2.5 0-3.8-1.4-5-3.4L4 13.8a1.3 1.3 0 0 1 2.1-1.5L8 14.5" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6z" />
      <path d="M18.5 15c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17.5v.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  list: <path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" />,
  phone: (
    <path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z" />
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  micOff: (
    <>
      <path d="M15 10V6a3 3 0 0 0-5.8-1M9 9v2a3 3 0 0 0 4.6 2.5M5.5 11a6.5 6.5 0 0 0 10.8 4.9M18.5 11a6.5 6.5 0 0 1-.4 2.2M12 17.5V21" />
      <path d="M4 4l16 16" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h8" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

// Start-page illustration: the signing hands on a soft blob, floating pastel
// shapes, and two speech bubbles that show what the app does (signs in,
// clinical sentence out). Friendly, but it explains the product.
export function HeroArt() {
  return (
    <div className="hero-art" aria-hidden="true">
      <span className="hero-hands">
        <Logo size={150} />
      </span>
      <i className="shape s-peach" />
      <i className="shape s-mint" />
      <i className="shape s-lilac" />
      <i className="shape s-yellow" />
      <span className="hero-bubble b-sign">
        <Icon name="hands" size={14} /> PAIN · CHEST
      </span>
      <span className="hero-bubble b-text">
        <Icon name="check" size={14} /> Patient reports chest pain
      </span>
    </div>
  );
}

// Waiting / empty state: an icon in a white circle with pulsing rings.
export function EmptyArt({ icon }: { icon: IconName }) {
  return (
    <div className="rings" aria-hidden="true">
      <i />
      <i />
      <i />
      <span>
        <Icon name={icon} size={26} />
      </span>
    </div>
  );
}
