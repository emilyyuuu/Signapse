import type { Encounter } from "./types";

// How a visit is named on staff screens: the name typed at check-in, else the token.
export const visitName = (e: Pick<Encounter, "patientName" | "patientRef">) => e.patientName ?? e.patientRef;

// A patient name as typed at check-in: letters from any language, spaces, and a few
// marks used in names. No digits, no angle brackets, no control characters.
export const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .’-]*$/u;
export const NAME_MAX = 60;

export function cleanName(raw: string): string | undefined {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name || name.length > NAME_MAX || !NAME_PATTERN.test(name)) return undefined;
  return name;
}

// True if the text contains the patient's name (or any part of it) as a word. Used as a
// last guard before anything is sent to Gemini: the name must never reach it.
export function mentionsName(text: string, name: string | undefined): boolean {
  if (!name) return false;
  const parts = name.split(/\s+/).filter((p) => p.length >= 2);
  const escape = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return parts.some((p) => new RegExp(`(^|[^\\p{L}])${escape(p)}($|[^\\p{L}])`, "iu").test(text));
}
