import { useCallback, useEffect, useMemo, useState } from "react";
import type { PainReading } from "@signapse/shared";
import { getEncounter, postPain } from "../../lib/api";

interface Reading {
  zone: string;
  severity: number;
  ts: string;
}

// Current pain per zone for one encounter: loads past readings, applies live
// ones, and keeps only the newest reading for each zone.
export function usePainMap(encounterId: string) {
  const [latest, setLatest] = useState<Record<string, Reading>>({});

  const apply = useCallback((r: Reading) => {
    setLatest((prev) => {
      const current = prev[r.zone];
      if (current && current.ts > r.ts) return prev; // an older reading arrived late
      return { ...prev, [r.zone]: { zone: r.zone, severity: r.severity, ts: r.ts } };
    });
  }, []);

  useEffect(() => {
    setLatest({});
    getEncounter(encounterId)
      .then((h) => h.pain.forEach(apply))
      .catch((err) => console.warn(err));
  }, [encounterId, apply]);

  // Shows the new level straight away, then sends it. Used by taps now and by
  // camera pointing later (source: "pointing").
  const report = useCallback(
    (zone: string, severity: number, source: PainReading["source"] = "tap") => {
      apply({ zone, severity, ts: new Date().toISOString() });
      return postPain({ encounterId, zone, severity, source });
    },
    [encounterId, apply],
  );

  const pain = useMemo(
    () => Object.fromEntries(Object.values(latest).map((r) => [r.zone, r.severity])),
    [latest],
  );

  return { pain, apply, report };
}
