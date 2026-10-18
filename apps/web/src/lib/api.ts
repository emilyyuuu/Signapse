import {
  DEMO_ENCOUNTER_ID,
  type ChartNote,
  type ReviewData,
  type ClauseRequest,
  type ClauseResult,
  type Encounter,
  type GrammarFlag,
  type SignEvent,
  type PainReading,
  type StoredPainReading,
  type StoredUtterance,
} from "@signapse/shared";

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

export async function createEncounter(clinicianId?: string): Promise<Encounter> {
  const res = await fetch(`${API_URL}/encounters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clinicianId ? { clinicianId } : {}),
  });
  if (!res.ok) throw new Error(`Could not start a visit (${res.status})`);
  return res.json();
}

export async function endEncounter(id: string): Promise<Encounter> {
  const res = await fetch(`${API_URL}/encounters/${id}/end`, { method: "POST" });
  if (!res.ok) throw new Error(`Could not end the visit (${res.status})`);
  return res.json();
}

export async function listActiveEncounters(): Promise<Encounter[]> {
  const res = await fetch(`${API_URL}/encounters?active=true`);
  if (!res.ok) throw new Error(`Could not load visits (${res.status})`);
  return res.json();
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

// Records that a clinician confirmed a line's meaning. The server pushes the
// updated line to every screen on the encounter.
export async function verifyUtterance(id: string, clinicianId: string): Promise<StoredUtterance | null> {
  try {
    const res = await fetch(`${API_URL}/utterances/${id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicianId }),
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export async function getReview(id: string): Promise<ReviewData> {
  const res = await fetch(`${API_URL}/encounters/${id}/review`);
  if (!res.ok) throw new Error(`GET /encounters/${id}/review failed: ${res.status}`);
  return res.json();
}

export async function getChartNote(id: string): Promise<ChartNote> {
  const res = await fetch(`${API_URL}/encounters/${id}/note`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /encounters/${id}/note failed: ${res.status}`);
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

// Starts and stops the pointing camera (apps/pointing) on the computer the API
// runs on. Only works from that computer, and only when LOCAL_CAMERA=true.
export interface CameraStatus {
  available: boolean;
  running: boolean;
  encounterId?: string;
  exited?: { code: number | null };
  log: string[];
}

async function cameraCall<T>(path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({}) as T & { error?: string }) };
  } catch {
    return { ok: false, status: 0, data: { error: "Can't reach the server." } as T & { error?: string } };
  }
}

export const startCamera = (encounterId: string) => cameraCall<{ running?: boolean }>("/camera/start", { encounterId });
export const stopCamera = () => cameraCall<{ running?: boolean }>("/camera/stop", {});
export const cameraStatus = () => cameraCall<CameraStatus>("/camera/status");
