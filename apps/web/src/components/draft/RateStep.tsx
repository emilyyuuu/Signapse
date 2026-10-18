import { ZONE_LABELS } from "@signapse/shared";

// Step 3: "How much does it hurt?" One tap on a number, 0 to 10.
export function RateStep({ zone, onPick }: { zone?: string; onPick: (level: number) => void }) {
  const where = zone && ZONE_LABELS[zone] ? `your ${ZONE_LABELS[zone].toLowerCase()}` : "it";
  return (
    <section className="panel step" aria-label="How much does it hurt?">
      <p className="eyebrow">Step 3 of 3</p>
      <h2 className="step-title">How much does {where} hurt?</h2>
      <div className="severity rate">
        {Array.from({ length: 11 }, (_, n) => (
          <button key={n} onClick={() => onPick(n)} aria-label={`${n} out of 10`}>
            {n}
          </button>
        ))}
      </div>
      <p className="step-scale">
        <span>0 = no pain</span>
        <span>10 = worst pain</span>
      </p>
    </section>
  );
}
