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

// One face/head sample inside a clause window. Stays on device.
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
  | { type: "pain"; data: StoredPainReading };

// Seeded in db/seed/encounters.sql and in the API's in-memory store.
export const DEMO_ENCOUNTER_ID = "00000000-0000-4000-8000-000000000001";
