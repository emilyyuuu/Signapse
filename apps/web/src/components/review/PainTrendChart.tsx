import { useMemo, useState, type MouseEvent } from "react";
import { ZONE_LABELS, type PainTrendPoint } from "@synapse/shared";

// Pain over time for one visit: one line per body zone, peak 0–10 per minute
// (Tiger continuous aggregate pain_by_minute). At most three zones are drawn,
// the three with the highest peak; the table view lists every zone.
const MAX_LINES = 3;
const W = 640;
const H = 240;
const PAD = { top: 16, right: 110, bottom: 30, left: 34 };

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function PainTrendChart({ trend }: { trend: PainTrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const { series, buckets, otherZones } = useMemo(() => {
    const byZone = new Map<string, { t: number; peak: number }[]>();
    for (const p of trend) {
      byZone.set(p.zone, [...(byZone.get(p.zone) ?? []), { t: Date.parse(p.bucket), peak: p.peak }]);
    }
    const ranked = [...byZone.entries()]
      .map(([zone, pts]) => ({ zone, pts: pts.sort((a, b) => a.t - b.t), max: Math.max(...pts.map((p) => p.peak)) }))
      .sort((a, b) => b.max - a.max || a.zone.localeCompare(b.zone));
    // Colour slot follows the zone's rank in this visit, fixed for the page's life.
    const series = ranked.slice(0, MAX_LINES).map((s, i) => ({ ...s, slot: i + 1 }));
    const buckets = [...new Set(trend.map((p) => Date.parse(p.bucket)))].sort((a, b) => a - b);
    return { series, buckets, otherZones: ranked.slice(MAX_LINES).map((s) => s.zone) };
  }, [trend]);

  if (trend.length === 0) return <p className="muted">No pain readings yet.</p>;

  // A single minute still gets a readable span either side.
  const t0 = buckets[0] - (buckets.length === 1 ? 60_000 : 0);
  const t1 = buckets[buckets.length - 1] + (buckets.length === 1 ? 60_000 : 0);
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / 10) * (H - PAD.top - PAD.bottom);

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (W - PAD.left - PAD.right) + PAD.left;
    const nearest = buckets.reduce((best, b) => (Math.abs(x(b) - px) < Math.abs(x(best) - px) ? b : best));
    setHover(nearest);
  };

  const hoverRows =
    hover === null
      ? []
      : series
          .map((s) => ({ s, p: s.pts.find((p) => p.t === hover) }))
          .filter((r) => r.p)
          .map((r) => ({ zone: r.s.zone, slot: r.s.slot, peak: r.p!.peak }));

  return (
    <div className="viz">
      <div className="legend">
        {series.map((s) => (
          <span key={s.zone}>
            <i style={{ background: `var(--series-${s.slot})` }} />
            {ZONE_LABELS[s.zone] ?? s.zone}
          </span>
        ))}
      </div>

      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Pain over time by body area">
          {[0, 5, 10].map((v) => (
            <g key={v}>
              <line className={v === 0 ? "axis" : "grid"} x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
              <text className="tick" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {[buckets[0], buckets[buckets.length - 1]].filter((b, i, a) => a.indexOf(b) === i).map((b) => (
            <text key={b} className="tick" x={x(b)} y={H - 8} textAnchor="middle">
              {time(b)}
            </text>
          ))}

          {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} />}

          {series.map((s) => {
            const last = s.pts[s.pts.length - 1];
            return (
              <g key={s.zone} style={{ color: `var(--series-${s.slot})` }}>
                <polyline className="series-line" points={s.pts.map((p) => `${x(p.t)},${y(p.peak)}`).join(" ")} />
                {s.pts.map((p) => (
                  <circle key={p.t} className="series-dot" cx={x(p.t)} cy={y(p.peak)} r={4} />
                ))}
                {/* Direct label at the line end, in text ink: identity never rests on colour alone. */}
                <text className="direct" x={x(last.t) + 10} y={y(last.peak) + 4}>
                  {ZONE_LABELS[s.zone] ?? s.zone} {last.peak}
                </text>
              </g>
            );
          })}

          <rect
            x={PAD.left}
            y={PAD.top}
            width={W - PAD.left - PAD.right}
            height={y(0) - PAD.top}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
        </svg>

        {hover !== null && hoverRows.length > 0 && (
          <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <strong>{time(hover)}</strong>
            {hoverRows.map((r) => (
              <div key={r.zone}>
                <i style={{ background: `var(--series-${r.slot})` }} />
                {ZONE_LABELS[r.zone] ?? r.zone}: {r.peak}/10
              </div>
            ))}
          </div>
        )}
      </div>

      {otherZones.length > 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          Also reported: {otherZones.map((z) => ZONE_LABELS[z] ?? z).join(", ")} (see table).
        </p>
      )}

      <details>
        <summary>Show as table</summary>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Area</th>
                <th>Peak pain</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((p) => (
                <tr key={`${p.bucket}|${p.zone}`}>
                  <td>{time(Date.parse(p.bucket))}</td>
                  <td>{ZONE_LABELS[p.zone] ?? p.zone}</td>
                  <td>{p.peak}/10</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
