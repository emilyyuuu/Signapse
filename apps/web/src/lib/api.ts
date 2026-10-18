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

export async function createEncounter(): Promise<Encounter> {
  const res = await fetch(`${API_URL}/encounters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
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
export async function verifyUtterance(id: string): Promise<StoredUtterance | null> {
  try {
    const res = await fetch(`${API_URL}/utterances/${id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}", // clinicians are not identified yet; the server records "Clinician"
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

// The patient checks what they signed before it goes to the doctor.
async function draftCall(encounterId: string, action: string, body: object): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/encounters/${encounterId}/draft/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: typeof data.error === "string" ? data.error : "Something went wrong." };
  } catch {
    return { ok: false, error: "Could not reach the server. Try again." };
  }
}

export const sendDraft = (encounterId: string, draftId: string) => draftCall(encounterId, "send", { draftId });
export const redoDraft = (encounterId: string, draftId: string) => draftCall(encounterId, "redo", { draftId });
export const holdDraft = (encounterId: string, draftId: string) => draftCall(encounterId, "hold", { draftId });
export const editDraft = (
  encounterId: string,
  draftId: string,
  change: { gloss?: string[]; grammarFlag?: GrammarFlag },
) => draftCall(encounterId, "edit", { draftId, ...change });

// Check-in: the patient (or staff) sets the name on the visit. The name goes in the
// request body, never in a URL, and is not logged.
export async function checkIn(
  encounterId: string,
  name: string,
): Promise<{ ok: boolean; error?: string; encounter?: Encounter }> {
  try {
    const res = await fetch(`${API_URL}/encounters/${encounterId}/name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, encounter: data as Encounter };
    return { ok: false, error: typeof data.error === "string" ? data.error : "Could not save the name." };
  } catch {
    return { ok: false, error: "Could not reach the server. Try again." };
  }
}
