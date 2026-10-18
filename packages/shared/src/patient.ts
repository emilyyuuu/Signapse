import { ZONE_LABELS } from "./bodyZones";
import { complaintOf, ratedFlag, signedLevel } from "./language";
import type { GrammarFlag } from "./types";

// What the patient sees before anything is sent: their own signing in short,
// plain, first-person sentences. Rule-based, never the language model, so the
// patient reads exactly what the rules understood. The doctor's sentence is
// written separately from the same signs and flag.

// Signs the patient can pick when fixing a word, with plain labels.
export const PATIENT_VOCAB: { token: string; text: string }[] = [
  { token: "PAIN", text: "Pain" },
  { token: "HEADACHE", text: "Headache" },
  { token: "HEAD", text: "Head" },
  { token: "FACE", text: "Face" },
  { token: "JAW", text: "Jaw" },
  { token: "CHEST", text: "Chest" },
  { token: "STOMACH", text: "Stomach" },
  { token: "BACK", text: "Back" },
  { token: "BREATHE", text: "Breathing" },
  { token: "DIZZY", text: "Dizzy" },
  { token: "NAUSEA", text: "Feel sick" },
  { token: "FEVER", text: "Fever" },
  { token: "VOMIT", text: "Throwing up" },
  { token: "COUGH", text: "Cough" },
  { token: "CHILLS", text: "Chills" },
  { token: "TIRED", text: "Tired" },
  { token: "WEAK", text: "Weak" },
  { token: "FAINT", text: "Feel faint" },
  { token: "NUMB", text: "Numb" },
  { token: "RASH", text: "Rash" },
  { token: "ITCH", text: "Itchy" },
  { token: "SWELLING", text: "Swelling" },
  { token: "BLEEDING", text: "Bleeding" },
  { token: "DIARRHEA", text: "Diarrhea" },
  { token: "ALLERGY", text: "Allergic reaction" },
  { token: "ANXIOUS", text: "Anxious" },
  { token: "HEARTATTACK", text: "Heart attack" },
  { token: "YES", text: "Yes" },
  { token: "NO", text: "No" },
];

// What the patient meant by their face, in their words.
export const MEANING_CHOICES: { flag: GrammarFlag; text: string; short: string }[] = [
  { flag: "statement", text: "I am telling you", short: "Telling" },
  { flag: "question", text: "I am asking a question", short: "A question" },
  { flag: "negation", text: "I am saying no", short: "No" },
  { flag: "intensified", text: "It is very bad", short: "Very bad" },
];

const POINT_PREFIX = "POINT-";

// A sign the server will accept when the patient edits their signing.
export function isAllowedSign(token: string): boolean {
  if (PATIENT_VOCAB.some((v) => v.token === token)) return true;
  if (token.startsWith(POINT_PREFIX) && token.slice(POINT_PREFIX.length).toLowerCase() in ZONE_LABELS) return true;
  return signedLevel([token]) !== undefined;
}

// A sign in plain words, e.g. POINT-LCHEST -> "Pointed: Left chest".
export function signText(token: string): string {
  const vocab = PATIENT_VOCAB.find((v) => v.token === token);
  if (vocab) return vocab.text;
  if (token.startsWith(POINT_PREFIX)) {
    const zone = token.slice(POINT_PREFIX.length).toLowerCase();
    return `Pointed: ${ZONE_LABELS[zone] ?? zone}`;
  }
  const level = signedLevel([token]);
  if (level !== undefined) return `Pain ${level} of 10`;
  return token.charAt(0) + token.slice(1).toLowerCase();
}

// "You said: I have chest pain." / "You said no. You do not have chest pain."
export function patientSentence(gloss: string[], faceFlag: GrammarFlag): string {
  const flag = ratedFlag(gloss, faceFlag);
  if (gloss.length === 1 && gloss[0] === "YES") return "You said yes.";
  if (gloss.length === 1 && gloss[0] === "NO") return "You said no.";
  const level = signedLevel(gloss);
  const { complaint } = complaintOf(gloss);
  if (level !== undefined && !complaint) return `You rate your pain ${level} out of 10.`;
  if (!complaint) return `You signed: ${gloss.map(signText).join(", ")}.`;
  const rated = level !== undefined ? ` It is ${level} out of 10.` : "";
  switch (flag) {
    case "question":
      return `You asked about ${complaint}.`;
    case "negation":
      return `You said no. You do not have ${complaint}.`;
    case "intensified":
      return `You said it is very bad: ${complaint}.${rated}`;
    default:
      return `You said: I have ${complaint}.${rated}`;
  }
}

// What the face showed, so the patient can check the meaning that came from it.
export function patientFaceLine(flag: GrammarFlag): string {
  switch (flag) {
    case "question":
      return "Your eyebrows showed a question.";
    case "negation":
      return "Your head shake showed no.";
    case "intensified":
      return "Your frown showed it is very strong.";
    default:
      return "Your face showed a plain statement.";
  }
}

export const meaningShort = (flag: GrammarFlag) => MEANING_CHOICES.find((m) => m.flag === flag)?.short ?? "Telling";
