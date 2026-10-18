import type { KeyboardEvent } from "react";
import { BODY_VIEWS, VIEW_BOXES, zoneCovers, type BodyView } from "@signapse/shared";

interface Props {
  view: BodyView;
  pain: Record<string, number>; // zone id -> severity 0–10
  selected?: string;
  // Zone the patient is pointing at or touching, from the camera.
  highlighted?: string;
  // The highlight is an unconfirmed suggestion (a touch): drawn dashed.
  tentative?: boolean;
  // Omit for a read-only map (clinician screen).
  onPick?: (zoneId: string) => void;
}

export function painFill(severity: number) {
  return severity > 0
    ? `color-mix(in srgb, var(--signal) ${Math.round(18 + 8 * severity)}%, var(--surface))`
    : "var(--surface-2)";
}

const LABELS: Record<BodyView, string> = { front: "front view", back: "back view", face: "face" };

export function BodyMap({ view, pain, selected, highlighted, tentative, onPick }: Props) {
  const box = VIEW_BOXES[view];
  return (
    <svg className="bodymap" viewBox={`0 0 ${box.w} ${box.h}`} role="group" aria-label={`Body map, ${LABELS[view]}`}>
      {view === "face" && <ellipse className="face-outline" cx={60} cy={70} rx={46} ry={58} />}
      {BODY_VIEWS[view].map((z) => {
        // A reading on a group (chest) or on a part this view doesn't draw (nose on
        // the body view) shows on every zone it covers.
        const severity = Math.max(
          0,
          ...Object.entries(pain)
            .filter(([zone]) => zoneCovers(z.id, zone, view))
            .map(([, s]) => s),
        );
        const label = `${z.label}${severity ? `, pain ${severity} of 10` : ""}`;
        const props = {
          className: [
            "zone",
            onPick && "interactive",
            selected && zoneCovers(z.id, selected, view) && "selected",
            highlighted && zoneCovers(z.id, highlighted, view) && "highlighted",
            highlighted && tentative && zoneCovers(z.id, highlighted, view) && "tentative",
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
