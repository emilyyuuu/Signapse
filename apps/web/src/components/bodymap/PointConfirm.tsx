import { ZONE_LABELS } from "@signapse/shared";

// What the camera found when the patient pointed: nod or Yes to rate it, shake or No to point again.
export function PointConfirm({ zone, onYes, onNo }: { zone: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="panel confirm-card" role="status" aria-live="polite">
      <p className="eyebrow">The camera found</p>
      <p className="confirm-zone">{ZONE_LABELS[zone] ?? zone}</p>
      <p className="muted" style={{ margin: "0 0 14px" }}>
        Is that right? <strong>Nod twice</strong> for yes, <strong>shake your head</strong> to point again, or use the
        buttons.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn primary big" onClick={onYes}>
          Yes, that&apos;s it
        </button>
        <button className="btn big" onClick={onNo}>
          No, try again
        </button>
      </div>
    </div>
  );
}
