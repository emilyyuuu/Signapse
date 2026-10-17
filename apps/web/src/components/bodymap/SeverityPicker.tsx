import { ZONE_LABELS } from "@synapse/shared";

interface Props {
  zone: string;
  value: number;
  onPick: (severity: number) => void;
}

// Big 0–10 buttons: easier than a slider for someone in pain on a tablet.
// One tap sets the level. Clear sends 0, which greys the zone out again.
export function SeverityPicker({ zone, value, onPick }: Props) {
  return (
    <div className="panel" role="group" aria-label={`Pain level for ${ZONE_LABELS[zone]}`}>
      <p style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 600 }}>
        How much does your {ZONE_LABELS[zone].toLowerCase()} hurt?
      </p>
      <div className="severity">
        {Array.from({ length: 11 }, (_, n) => (
          <button key={n} aria-pressed={value === n} onClick={() => onPick(n)}>
            {n}
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: "8px 0 12px", display: "flex", justifyContent: "space-between" }}>
        <span>0 = no pain</span>
        <span>10 = worst pain</span>
      </p>
      <button className="btn" onClick={() => onPick(0)}>
        Clear
      </button>
    </div>
  );
}
