import { describeFace } from "./face";
import { assessUtterance } from "./language";
import type { GrammarFlag, StoredUtterance } from "./types";

// How the clinician screen's voice should sound for a line, from the facial
// grammar flag and how strong the face cues were. Only pitch, rate and volume:
// browser voices can't do more, and the words are never changed.

export interface VoiceTone {
  flag: GrammarFlag;
  strong: boolean;
  pitch: number; // 0–2, 1 = the voice's normal pitch
  rate: number; // 1 = normal speed
  volume: number; // 0–1
  label: string; // shown next to the speaker button, e.g. "questioning"
}

const BASE = { pitch: 1, rate: 0.95, volume: 0.9 };

// [normal, strong] for each flag.
const TONES: Record<GrammarFlag, [Partial<typeof BASE>, Partial<typeof BASE>, string]> = {
  statement: [{}, {}, "neutral"],
  // Raised eyebrows: a rising, slightly lighter voice.
  question: [{ pitch: 1.15 }, { pitch: 1.25 }, "questioning"],
  // Head shake: lower and a little slower, firm.
  negation: [{ pitch: 0.88, rate: 0.9 }, { pitch: 0.8, rate: 0.85 }, "firm"],
  // Furrowed brows or squint: slower and louder, each word weighted.
  intensified: [{ rate: 0.85, volume: 1 }, { rate: 0.8, volume: 1, pitch: 1.05 }, "emphatic"],
};

export function voiceTone(u: Pick<StoredUtterance, "grammarFlag" | "nmm">, urgent = false): VoiceTone {
  const flag = u.grammarFlag ?? "statement";
  const strong = describeFace(u.nmm, flag).strong === true && flag !== "statement";
  const [normal, strongTone, label] = TONES[flag];
  const tone = { ...BASE, ...(strong ? strongTone : normal) };
  // Urgent lines are said a touch faster and at full volume, whatever the face said.
  if (urgent) {
    tone.rate = Math.min(1.05, tone.rate + 0.1);
    tone.volume = 1;
  }
  return { flag, strong, ...tone, label: strong ? `strongly ${label}` : label };
}

// A spoken line: the sentence in its tone, then the confirm reminder (if any)
// in a plain voice so it never sounds like part of what the patient said.
export function spokenParts(u: StoredUtterance) {
  const { urgent, needsConfirm } = assessUtterance(u);
  const tone = voiceTone(u, urgent);
  const parts = [{ text: urgent ? `Urgent. ${u.sentence}` : u.sentence, tone }];
  if (needsConfirm) parts.push({ text: "Please confirm with the patient.", tone: voiceTone({}) });
  return parts;
}
