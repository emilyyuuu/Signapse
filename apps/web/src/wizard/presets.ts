import type { GrammarFlag } from "@signapse/shared";

// One-tap lines for the demo script. Edit freely: each is sent exactly as if
// sign recognition and facial grammar had produced it.
export interface Preset {
  label: string;
  gloss: string[];
  flag: GrammarFlag;
}

export const PRESETS: Preset[] = [
  { label: "I have chest pain", gloss: ["PAIN", "CHEST"], flag: "statement" },
  { label: "No chest pain", gloss: ["NO", "PAIN", "CHEST"], flag: "negation" },
  { label: "Trouble breathing?", gloss: ["BREATHE"], flag: "question" },
  { label: "Very bad headache", gloss: ["PAIN", "HEAD"], flag: "intensified" },
  { label: "Pain here (left chest)", gloss: ["PAIN", "POINT-LCHEST"], flag: "statement" },
  { label: "Stomach pain", gloss: ["PAIN", "STOMACH"], flag: "statement" },
  { label: "Feel sick", gloss: ["NAUSEA"], flag: "statement" },
  { label: "Dizzy", gloss: ["DIZZY"], flag: "statement" },
  { label: "Pain 8 of 10", gloss: ["NUM-8"], flag: "statement" },
  { label: "Yes", gloss: ["YES"], flag: "statement" },
  { label: "No", gloss: ["NO"], flag: "negation" },
];
