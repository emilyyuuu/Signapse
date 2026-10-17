import { z } from "zod";

// Input rules shared by several endpoints. Everything is short text or numbers,
// so no field can carry video, images or landmarks.

// Sign labels only (e.g. PAIN, CHEST): uppercase sign names, so no free text
// such as names or notes can reach the language model.
export const glossSchema = z.array(z.string().regex(/^[A-Z][A-Z0-9-]{0,24}$/)).min(1).max(20);

export const grammarFlagSchema = z.enum(["statement", "question", "negation", "intensified"]);

// Summary of the facial markers behind a flag, e.g. {"browRaise": 0.82, "headShakes": 3}.
export const nmmSchema = z
  .record(z.union([z.number(), z.string().min(1).max(40)]))
  .refine((o) => Object.keys(o).length <= 20, "too many markers");

export const confidenceSchema = z.number().min(0).max(1);
