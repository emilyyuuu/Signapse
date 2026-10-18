import { useState } from "react";
import type { BodyView } from "@signapse/shared";
import { BodyMap } from "../bodymap/BodyMap";

const VIEW_NAMES: Record<BodyView, string> = { front: "Front", back: "Back", face: "Face" };

// Step 2: "Where does it hurt?" One tap on the body (or pointing at it with
// the camera) answers it and moves on.
export function WhereStep({ highlighted, onPick }: { highlighted?: string; onPick: (zone: string) => void }) {
  const [view, setView] = useState<BodyView>("front");
  return (
    <section className="panel step where" aria-label="Where does it hurt?">
      <p className="eyebrow">Step 2 of 3</p>
      <h2 className="step-title">Where does it hurt?</h2>
      <p className="step-help">Tap the place on the body, or point to it.</p>
      <div className="seg" style={{ margin: "0 auto 12px" }}>
        {(["front", "back", "face"] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
            {VIEW_NAMES[v]}
          </button>
        ))}
      </div>
      <div className="where-map">
        <BodyMap view={view} pain={{}} highlighted={highlighted} onPick={onPick} mirrored />
      </div>
    </section>
  );
}
