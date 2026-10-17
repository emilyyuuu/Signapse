// Shared contracts between sign recognition, facial grammar, language, API and screens.
// Agree changes here before building against them.

export type GrammarFlag = "statement" | "question" | "negation" | "intensified";

// Produced by sign recognition (or wizard mode, with the same shape).
export interface SignEvent {
  label: string;
  confidence: number;
  startMs: number;
  endMs: number;
}

// One face/head sample inside a clause window. Stays on device: produced and consumed inside
// apps/facial_grammar (Python equivalent: datatypes.py Frame). Only the flag and nmm scores cross over.
export interface FaceFrame {
  t: number;
  browInnerUp: number;
  browOuterUp: number;
  browDown: number;
  eyeSquint: number;
  headYaw: number;
  headPitch: number;
}

// The signs in one clause plus its face/head frames; facial grammar turns it into a flag.
export interface ClauseWindow {
  signs: SignEvent[];
  frames: FaceFrame[];
}

export type Speaker = "patient" | "clinician";
export type UtteranceKind = "sign" | "reply" | "answer";

// Text-only event, mirrors the `utterances` table. The only thing that leaves the device.
export interface UtteranceEvent {
  encounterId: string;
  speaker: Speaker;
  kind: UtteranceKind;
  gloss?: string[];
  nmm?: Record<string, number | string>;
  grammarFlag?: GrammarFlag;
  sentence: string;
  plainText?: string;
  confidence?: number;
}

// Mirrors the `pain_readings` table.
export interface PainReading {
  encounterId: string;
  zone: string;
  severity: number; // 0–10
  source: "tap" | "pointing";
}

// Anything that produces signs: wizard mode now, camera recognition later.
// Both feed the same pipeline, so the demo path never changes.
export interface SignSource {
  onSign(cb: (sign: SignEvent) => void): () => void;
  onClause(cb: (clause: ClauseWindow) => void): () => void;
}

export type Priority = "routine" | "urgent";

// Output of the clinical sentence processor for one clause.
export interface ClinicalSentence {
  sentence: string;
  complaint?: string;
  zone?: string;
  priority: Priority;
  needsConfirm: boolean; // meaning depends on a facial marker or low confidence
}

// POST /translate response: which engine wrote the sentence.
export interface TranslateResult extends ClinicalSentence {
  source: "gemini" | "template";
  face: string; // plain-words facial summary, e.g. "head shook 3 times → denial"
}

// POST /clauses: what sign recognition sends when the patient pauses.
export interface ClauseRequest {
  encounterId: string;
  gloss: string[]; // sign labels, e.g. ["PAIN", "CHEST"]
  grammarFlag: GrammarFlag; // from the facial grammar engine
  confidence?: number; // 0–1, lowest sign confidence in the clause
  nmm?: Record<string, number | string>; // facial-marker summary, e.g. {"browRaise": 0.82}
}

export interface ClauseResult {
  utterance: StoredUtterance;
  priority: Priority;
  needsConfirm: boolean;
  source: TranslateResult["source"];
  face: string;
}

export interface Encounter {
  encounterId: string;
  patientRef: string;
  clinicianId: string;
  signLanguage: string;
  startedAt: string;
  endedAt?: string;
}

// Rows as stored and returned by the API.
export interface StoredUtterance extends UtteranceEvent {
  id: string;
  ts: string;
  verifiedBy?: string;
  verifiedAt?: string;
}

export interface StoredPainReading extends PainReading {
  ts: string;
}

// Messages pushed to every browser in an encounter's WebSocket room.
export type RoomMessage =
  | { type: "utterance"; data: StoredUtterance }
  | { type: "verified"; data: StoredUtterance } // a clinician confirmed an existing line
  | { type: "pain"; data: StoredPainReading }
  | { type: "ended"; data: Encounter }; // the visit was ended; screens stop accepting input

// One point of the pain trend (continuous aggregate pain_by_minute).
export interface PainTrendPoint {
  bucket: string;
  zone: string;
  peak: number;
}

// GET /encounters/:id/review
export interface ReviewData {
  encounter: Encounter;
  utterances: StoredUtterance[];
  pain: StoredPainReading[];
  painTrend: PainTrendPoint[];
  stats: { lines: number; urgent: number; unconfirmed: number };
}

// One line of the chart note, taken straight from a stored utterance.
export interface NoteItem {
  id: string;
  ts: string;
  text: string;
  gloss?: string[];
  confirmed: boolean;
  needsConfirm: boolean;
  verifiedBy?: string;
}

// POST /encounters/:id/note. Facts come from stored data, never from the
// language model; only aiSummary is model-written, and it is labelled so.
export interface ChartNote {
  encounter: Pick<Encounter, "encounterId" | "patientRef" | "clinicianId" | "startedAt" | "endedAt">;
  generatedAt: string;
  chiefComplaint?: string;
  reported: NoteItem[];
  denied: NoteItem[];
  patientQuestions: NoteItem[];
  clinicianReplies: NoteItem[];
  patientAnswers: NoteItem[];
  pain: { zone: string; label: string; peak: number; latest: number; trend: "rising" | "falling" | "steady" }[];
  urgentFlags: NoteItem[];
  unconfirmedCount: number;
  aiSummary?: string;
}

// Seeded in db/seed/encounters.sql and in the API's in-memory store.
export const DEMO_ENCOUNTER_ID = "00000000-0000-4000-8000-000000000001";
