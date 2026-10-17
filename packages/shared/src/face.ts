import type { GrammarFlag } from "./types";

// Turns the facial-marker scores from apps/facial_grammar (GrammarResult.to_nmm)
// into plain words for Gemini and the clinician. The flag stays authoritative;
// these words only explain it and say how strong it was.

// Same values as Thresholds in apps/facial_grammar/datatypes.py. Keep in sync
// if those are tuned, so we only describe what the grammar engine counted.
const TH = { browUp: 0.15, browHoldMs: 300, browDown: 0.05, squint: 0.3, furrowHoldMs: 240, minYawFlips: 2 };

// Above these a cue is "strong" (clearly exaggerated, not just present).
const STRONG = { browUp: 0.35, browDown: 0.25, eyeSquint: 0.5, furrowHoldMs: 1000, yawFlips: 4 };

export const FLAG_MEANING: Record<GrammarFlag, string> = {
  statement: "statement",
  question: "yes/no question",
  negation: "denial",
  intensified: "emphasis",
};

export interface FaceDescription {
  cues: string[]; // e.g. ["head shook 3 times"]
  strong?: boolean; // undefined when there were no face scores at all
  summary: string; // e.g. "head shook 3 times → denial"
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function describeFace(
  nmm: Record<string, number | string> | undefined,
  flag: GrammarFlag,
): FaceDescription {
  const num = (k: string) => (typeof nmm?.[k] === "number" ? (nmm[k] as number) : 0);
  const cues: string[] = [];
  let strong = false;

  const flips = num("headYawFlips");
  if (flips >= TH.minYawFlips) {
    cues.push(`head shook ${flips} times`);
    strong ||= flips >= STRONG.yawFlips;
  }

  const browUp = num("browUp");
  const browHold = num("browHoldMs");
  if (browUp > TH.browUp && browHold >= TH.browHoldMs) {
    cues.push(`eyebrows raised for ${seconds(browHold)}`);
    strong ||= browUp >= STRONG.browUp;
  }

  const furrowHold = num("furrowHoldMs");
  if (furrowHold >= TH.furrowHoldMs) {
    const furrowed = num("browDown") > TH.browDown;
    const squinting = num("eyeSquint") > TH.squint;
    const what =
      furrowed && squinting
        ? "brows furrowed and eyes squinting"
        : squinting
          ? "eyes squinting"
          : furrowed
            ? "brows furrowed"
            : "brows furrowed or eyes squinting";
    cues.push(`${what} for ${seconds(furrowHold)}`);
    strong ||=
      furrowHold >= STRONG.furrowHoldMs || num("browDown") >= STRONG.browDown || num("eyeSquint") >= STRONG.eyeSquint;
  }

  const meaning = FLAG_MEANING[flag];
  const summary = cues.length
    ? `${cues.join(", ")}${strong ? " (strong)" : ""} → ${meaning}`
    : nmm
      ? `neutral face → ${meaning}`
      : meaning;
  return { cues, strong: nmm ? strong : undefined, summary };
}
