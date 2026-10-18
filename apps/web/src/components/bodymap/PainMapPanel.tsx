import type { CSSProperties } from "react";
import { ZONE_LABELS } from "@signapse/shared";
import { BodyMap } from "./BodyMap";
import { PainList } from "./PainList";
import type { Pointed } from "./usePointing";

// The patient's pain on front, back and face views, live, with where they are
// pointing or touching right now. Shared by the clinician screen and the
// doctor's call screen.
export function PainMapPanel({
  pain,
  pointed,
  style,
}: {
  pain: Record<string, number>;
  pointed?: Pointed;
  style?: CSSProperties;
}) {
  return (
    <section className="panel pop pop-blue" style={style} aria-label="Patient body map">
      <h2 className="section-title">Pain map</h2>
      {pointed && (
        <p className="callout" role="status">
          {pointed.gesture === "touch" ? "Touched" : "Pointing at"}: <strong>{ZONE_LABELS[pointed.zone]}</strong>
          {pointed.complaint && <> · {pointed.complaint}</>}
          {pointed.gesture === "touch" && !pointed.confirmed ? (
            <> · not confirmed, the patient is checking it</>
          ) : pain[pointed.zone] ? (
            <> · {pain[pointed.zone]}/10</>
          ) : (
            <> · severity not rated yet</>
          )}
        </p>
      )}
      <div className="row" style={{ gap: 8, justifyContent: "center" }}>
        {(["front", "back", "face"] as const).map((v) => (
          <figure key={v} style={{ margin: 0, flex: "1 1 100px", maxWidth: 150 }}>
            <BodyMap
              view={v}
              pain={pain}
              highlighted={pointed?.zone}
              tentative={pointed?.gesture === "touch" && !pointed.confirmed}
            />
            <figcaption className="muted" style={{ textAlign: "center", fontSize: 13 }}>
              {v === "front" ? "Front" : v === "back" ? "Back" : "Face"}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="painlist-card">
        <PainList pain={pain} />
      </div>
    </section>
  );
}
