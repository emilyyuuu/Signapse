import { ZONE_LABELS, painPriority } from "@signapse/shared";

// Zones in pain, most severe first, with the same urgency rule as signed pain.
export function PainList({ pain }: { pain: Record<string, number> }) {
  const rows = Object.entries(pain)
    .filter(([, severity]) => severity > 0)
    .sort((a, b) => b[1] - a[1]);

  if (rows.length === 0) return <p className="muted">No pain reported yet.</p>;

  return (
    <ul className="painlist">
      {rows.map(([zone, severity]) => (
        <li key={zone}>
          <span>{ZONE_LABELS[zone] ?? zone}</span>
          <span className="bar">
            <i style={{ width: `${severity * 10}%` }} />
          </span>
          <span>{severity}/10</span>
          {painPriority(zone, severity) === "urgent" ? <span className="chip urgent">Urgent</span> : <span />}
        </li>
      ))}
    </ul>
  );
}
