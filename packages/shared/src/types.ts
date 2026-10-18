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
  // How the patient confirmed this line before it was sent (signed clauses).
  patientConfirmation?: PatientConfirmation;
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
  patientRef: string; // internal token, e.g. PT-7K3Q
  patientName?: string; // typed at check-in; see db/migrations/003_patient_name.sql
  clinicianId: string; // no longer entered anywhere; kept as an internal default
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

// POST /point: the patient is pointing at or touching this zone on their own
// body (from apps/pointing). Not stored: the clause gloss (POINT-<ZONE>) and the
// pain reading the patient then confirms are the record.
export interface PointEvent {
  encounterId: string;
  zone: string;
  confidence: number; // 0–1
  gesture?: "point" | "touch"; // index finger out, or any hand shape on the body
}

export interface StoredPointEvent extends PointEvent {
  ts: string;
}

// POST /gesture: the patient nodded or shook their head (from apps/pointing). After they
// point at a body part, a nod confirms it and opens the pain scale; a shake cancels.
// Not stored: the confirmed pain reading is the record.
export interface GestureEvent {
  encounterId: string;
  gesture: "nod" | "shake";
  confidence?: number; // 0–1
}

export interface StoredGestureEvent extends GestureEvent {
  ts: string;
}

// The patient checks what they signed before it goes to the doctor.
// sent: sent as understood; edited: they fixed it first; auto_sent: an urgent line
// that sent itself after 10 s because they did not answer; redone: signed again.
export type PatientAction = "sent" | "edited" | "auto_sent" | "redone";

export interface PatientConfirmation {
  action: "sent" | "edited" | "auto_sent";
  redos: number; // how many times they signed again before this one
  original?: { gloss: string[]; grammarFlag: GrammarFlag }; // before their edits
}

// One row of the patient action log (table patient_actions).
export interface PatientActionLog {
  encounterId: string;
  draftId: string;
  action: PatientAction;
  urgent: boolean;
  detail?: { gloss: string[]; grammarFlag: GrammarFlag };
}

// A signed clause waiting for the patient. Held in server memory and shown only
// to patient screens; it is not saved or sent to the doctor until they press Send.
export interface DraftView {
  id: string;
  encounterId: string;
  gloss: string[];
  grammarFlag: GrammarFlag;
  patientText: string; // "You said: I have chest pain."
  faceText: string; // "Your frown showed it is very strong."
  urgent: boolean;
  autoSendAt?: string; // urgent drafts send themselves at this time
  now: string; // server clock when this was sent, to count down without clock drift
  edited: boolean;
  redos: number;
  createdAt: string;
}

// Messages pushed to every browser in an encounter's WebSocket room.
export type RoomMessage =
  | { type: "utterance"; data: StoredUtterance }
  | { type: "verified"; data: StoredUtterance } // a clinician confirmed an existing line
  | { type: "pain"; data: StoredPainReading }
  | { type: "point"; data: StoredPointEvent }
  | { type: "gesture"; data: StoredGestureEvent }
  | { type: "draft"; data: DraftView } // patient screens only
  | { type: "draft_closed"; data: { id: string; action: PatientAction } } // patient screens only // the patient pointed at or touched a body part
  | { type: "encounter"; data: Encounter } // the visit changed (e.g. the patient checked in)
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
  // How the patient confirmed it before it was sent (signed lines).
  patientAction?: PatientConfirmation["action"];
}

// POST /encounters/:id/note. Facts come from stored data, never from the
// language model; only aiSummary is model-written, and it is labelled so.
export interface ChartNote {
  encounter: Pick<Encounter, "encounterId" | "patientRef" | "patientName" | "clinicianId" | "startedAt" | "endedAt">;
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
