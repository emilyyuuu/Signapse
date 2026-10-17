import type { KeyboardEvent } from "react";
import { BODY_VIEWS, type BodyView } from "@synapse/shared";

interface Props {
  view: BodyView;
  pain: Record<string, number>; // zone id -> severity 0–10
  selected?: string;
  // Zone the patient's fingertip is over, for the camera pointing feature.
  highlighted?: string;
  // Omit for a read-only map (clinician screen).
  onPick?: (zoneId: string) => void;
}

export function painFill(severity: number) {
  return severity > 0
    ? `color-mix(in srgb, var(--signal) ${Math.round(18 + 8 * severity)}%, var(--surface))`
    : "var(--surface-2)";
}

export function BodyMap({ view, pain, selected, highlighted, onPick }: Props) {
  return (
    <svg className="bodymap" viewBox="0 0 200 414" role="group" aria-label={`Body map, ${view} view`}>
      {BODY_VIEWS[view].map((z) => {
        const severity = pain[z.id] ?? 0;
        const label = `${z.label}${severity ? `, pain ${severity} of 10` : ""}`;
        const props = {
          className: [
            "zone",
            onPick && "interactive",
            selected === z.id && "selected",
            highlighted === z.id && "highlighted",
          ]
            .filter(Boolean)
            .join(" "),
          fill: painFill(severity),
          ...(onPick && {
            tabIndex: 0,
            role: "button",
            "aria-label": label,
            onClick: () => onPick(z.id),
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(z.id);
              }
            },
          }),
        };
        return z.shape === "ellipse" ? (
          <ellipse key={z.id} {...props} cx={z.x} cy={z.y} rx={z.w} ry={z.h}>
            <title>{label}</title>
          </ellipse>
        ) : (
          <rect key={z.id} {...props} x={z.x} y={z.y} width={z.w} height={z.h} rx={z.r}>
            <title>{label}</title>
          </rect>
        );
      })}
    </svg>
  );
}
