import { randomUUID } from "node:crypto";
import {
  assessPriority,
  patientFaceLine,
  patientSentence,
  ratedFlag,
  type DraftView,
  type GrammarFlag,
} from "@signapse/shared";
import { broadcast } from "./ws/rooms.js";

// A signed clause waits here for the patient to check it. It lives in server
// memory only: it is not saved to the database and not sent to the clinician
// screens until the patient presses Send (or, for urgent ones, 10 s pass).
// One draft per visit; a new clause replaces the old one.

const autoSendMs = () => Number(process.env.URGENT_AUTOSEND_MS ?? 10_000);
const MAX_WAIT_MS = 2 * 60_000; // longest an urgent draft can be held while the patient edits

export interface Draft {
  id: string;
  encounterId: string;
  gloss: string[];
  grammarFlag: GrammarFlag;
  confidence?: number;
  nmm?: Record<string, number | string>;
  edited: boolean;
  original?: { gloss: string[]; grammarFlag: GrammarFlag };
  redos: number;
  createdAt: number;
  autoSendAt?: number;
  timer?: ReturnType<typeof setTimeout>;
}

const drafts = new Map<string, Draft>(); // by encounter id
const redoCounts = new Map<string, number>(); // signed-again count since the last send

let onAutoSend: (d: Draft) => void = () => {};
// The routes decide how a draft is finalized (translate, save, broadcast).
export function setAutoSendHandler(fn: (d: Draft) => void) {
  onAutoSend = fn;
}

export const isUrgent = (d: Pick<Draft, "gloss" | "grammarFlag">) => assessPriority(d.gloss, d.grammarFlag) === "urgent";

export function view(d: Draft): DraftView {
  // Once pain is rated, the patient's answer is the meaning, not the face (ratedFlag).
  const flag = ratedFlag(d.gloss, d.grammarFlag);
  return {
    id: d.id,
    encounterId: d.encounterId,
    gloss: d.gloss,
    grammarFlag: flag,
    patientText: patientSentence(d.gloss, flag),
    faceText: patientFaceLine(flag),
    urgent: isUrgent(d),
    autoSendAt: d.autoSendAt ? new Date(d.autoSendAt).toISOString() : undefined,
    now: new Date().toISOString(),
    edited: d.edited,
    redos: d.redos,
    createdAt: new Date(d.createdAt).toISOString(),
  };
}

export const pendingView = (encounterId: string): DraftView | undefined => {
  const d = drafts.get(encounterId);
  return d ? view(d) : undefined;
};

// Urgent drafts send themselves so an emergency can't wait on a button press.
function arm(d: Draft, from = Date.now()) {
  clearTimeout(d.timer);
  d.timer = undefined;
  d.autoSendAt = undefined;
  if (!isUrgent(d)) return;
  const at = Math.min(from + autoSendMs(), d.createdAt + MAX_WAIT_MS);
  d.autoSendAt = at;
  d.timer = setTimeout(() => {
    // Only fire if this exact draft is still waiting.
    if (drafts.get(d.encounterId) === d) onAutoSend(d);
  }, Math.max(0, at - Date.now()));
}

// Returns the draft that this one replaced, if the patient hadn't answered it.
export function createDraft(input: {
  encounterId: string;
  gloss: string[];
  grammarFlag: GrammarFlag;
  confidence?: number;
  nmm?: Record<string, number | string>;
}): { draft: Draft; replaced?: Draft } {
  const replaced = drafts.get(input.encounterId);
  if (replaced) {
    clearTimeout(replaced.timer);
    redoCounts.set(input.encounterId, (redoCounts.get(input.encounterId) ?? 0) + 1);
  }
  const draft: Draft = {
    id: randomUUID(),
    ...input,
    edited: false,
    redos: redoCounts.get(input.encounterId) ?? 0,
    createdAt: Date.now(),
  };
  drafts.set(input.encounterId, draft);
  arm(draft);
  broadcast(input.encounterId, { type: "draft", data: view(draft) }, "patient");
  return { draft, replaced };
}

// Removes the draft (it is being sent or discarded). Undefined if it is not the waiting one.
export function takeDraft(encounterId: string, draftId: string): Draft | undefined {
  const d = drafts.get(encounterId);
  if (!d || d.id !== draftId) return undefined;
  clearTimeout(d.timer);
  drafts.delete(encounterId);
  return d;
}

// Saving failed: keep the draft so nothing is lost. Urgent ones retry on their own.
export function restoreDraft(d: Draft, retryMs?: number) {
  if (drafts.has(d.encounterId)) return; // a newer clause already replaced it
  drafts.set(d.encounterId, d);
  if (isUrgent(d)) arm(d, Date.now() - autoSendMs() + (retryMs ?? autoSendMs()));
  broadcast(d.encounterId, { type: "draft", data: view(d) }, "patient");
}

export function noteSent(encounterId: string) {
  redoCounts.delete(encounterId);
}

export function noteRedo(encounterId: string) {
  redoCounts.set(encounterId, (redoCounts.get(encounterId) ?? 0) + 1);
}

export function editDraft(
  encounterId: string,
  draftId: string,
  changes: { gloss?: string[]; grammarFlag?: GrammarFlag },
): Draft | undefined {
  const d = drafts.get(encounterId);
  if (!d || d.id !== draftId) return undefined;
  d.original ??= { gloss: d.gloss, grammarFlag: d.grammarFlag };
  if (changes.gloss) d.gloss = changes.gloss;
  if (changes.grammarFlag) d.grammarFlag = changes.grammarFlag;
  d.edited = true;
  arm(d); // they are actively working on it: restart the urgent countdown
  broadcast(encounterId, { type: "draft", data: view(d) }, "patient");
  return d;
}

// The patient has the edit panel open: give an urgent draft more time (never past MAX_WAIT_MS).
export function holdDraft(encounterId: string, draftId: string): Draft | undefined {
  const d = drafts.get(encounterId);
  if (!d || d.id !== draftId) return undefined;
  arm(d);
  broadcast(encounterId, { type: "draft", data: view(d) }, "patient");
  return d;
}

export function clearEncounter(encounterId: string) {
  const d = drafts.get(encounterId);
  if (d) clearTimeout(d.timer);
  drafts.delete(encounterId);
  redoCounts.delete(encounterId);
}
