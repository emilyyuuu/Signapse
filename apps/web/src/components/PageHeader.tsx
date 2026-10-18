import type { ReactNode } from "react";

// Small muted line above a large medium-weight title, with optional intro
// text and actions on the right (e.g. round icon buttons).
export function PageHeader({
  greet,
  title,
  children,
  aside,
}: {
  greet?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {greet && <p className="greet">{greet}</p>}
        <h1 className="page-title">{title}</h1>
        {children && <div className="lede">{children}</div>}
      </div>
      {aside && <div className="page-head-aside">{aside}</div>}
    </div>
  );
}
