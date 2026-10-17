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
