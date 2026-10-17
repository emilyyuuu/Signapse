import { useCallback, useEffect, useRef, useState } from "react";
import { complaintOf, pointedZone, regionOf, type RoomMessage } from "@synapse/shared";

export interface Pointed {
  zone: string;
  gesture?: "point" | "touch";
  // A touch is only a suggestion until the patient rates that zone.
  confirmed?: boolean;
  complaint?: string; // what they signed about it, e.g. "chest pain"
  at: number;
}

const SHOW_MS = 6000;

// The zone the patient is pointing at or touching, from the camera (`point`
// messages) or a clause with a POINT-<ZONE> sign, plus what they signed about it.
// Clears itself.
export function usePointing() {
  const [pointed, setPointed] = useState<Pointed>();
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback((p: Pointed) => {
    setPointed(p);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPointed(undefined), SHOW_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Returns the zone when this message is a new point, so callers can react.
  const handle = useCallback(
    (msg: RoomMessage): string | undefined => {
      if (msg.type === "point") {
        // The clause that names the complaint usually arrives after the point.
        show({ zone: msg.data.zone, gesture: msg.data.gesture, at: Date.now() });
        return msg.data.zone;
      }
      if (msg.type === "pain") {
        const zone = msg.data.zone;
        setPointed((p) => (p && p.zone === zone ? { ...p, confirmed: true } : p));
        return;
      }
      if (msg.type !== "utterance" || msg.data.speaker !== "patient" || !msg.data.gloss) return;
      const { complaint, zone } = complaintOf(msg.data.gloss);
      if (pointedZone(msg.data.gloss) && zone) {
        show({ zone, complaint, at: Date.now() });
        return zone;
      }
      // A signed complaint about the zone already highlighted (or its region:
      // signed CHEST while pointing at the left chest) adds context.
      if (zone) setPointed((p) => (p && (p.zone === zone || regionOf(p.zone) === zone) ? { ...p, complaint } : p));
    },
    [show],
  );

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setPointed(undefined);
  }, []);

  return { pointed, handle, clear };
}
