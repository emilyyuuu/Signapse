import {
  DEMO_ENCOUNTER_ID,
  type Encounter,
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
