import {
  DEMO_ENCOUNTER_ID,
  type ClauseRequest,
  type ClauseResult,
  type Encounter,
  type GrammarFlag,
  type SignEvent,
  type PainReading,
  type StoredPainReading,
  type StoredUtterance,
} from "@synapse/shared";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

// Both screens join the same encounter, picked with ?e=<id> in the URL.
export function encounterIdFromUrl() {
  return new URLSearchParams(location.search).get("e") ?? DEMO_ENCOUNTER_ID;
}

export interface EncounterHistory {
  encounter: Encounter;
  utterances: StoredUtterance[];
  pain: StoredPainReading[];
}

export async function getEncounter(id: string): Promise<EncounterHistory> {
  const res = await fetch(`${API_URL}/encounters/${id}`);
  if (!res.ok) throw new Error(`GET /encounters/${id} failed: ${res.status}`);
  return res.json();
}

// Called by sign recognition when the patient pauses after a clause.
// Sends the recognised signs plus the facial-grammar flag; the server writes
// the clinical sentence, saves it and pushes it to the clinician screen.
export async function sendClause(
  encounterId: string,
  signs: SignEvent[],
  grammarFlag: GrammarFlag,
  nmm?: ClauseRequest["nmm"],
): Promise<ClauseResult | null> {
  if (signs.length === 0) return null;
  const body: ClauseRequest = {
    encounterId,
    gloss: signs.map((s) => s.label.toUpperCase()),
    grammarFlag,
    confidence: Math.min(...signs.map((s) => s.confidence)),
    nmm,
  };
  try {
    const res = await fetch(`${API_URL}/clauses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`POST /clauses failed: ${res.status} ${await res.text()}`);
      return null;
    }
    return res.json();
  } catch (err) {
    console.warn("POST /clauses failed", err);
    return null;
  }
}

export async function postPain(reading: PainReading): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/pain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reading),
    });
    return res.ok;
  } catch {
    return false;
  }
}
