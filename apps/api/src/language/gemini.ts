import type { GrammarFlag } from "@synapse/shared";

export interface GeminiConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

const INSTRUCTIONS = `You turn ASL gloss signed by a Deaf patient into one short clinical sentence for a doctor.
Rules:
- Write in the third person, starting with "The patient".
- Use only what the gloss says. Never add symptoms, body parts, durations, causes or severity that are not in it.
- The grammar flag comes from the facial grammar engine and is final. Never contradict it:
  statement = the patient is telling you this;
  question = the patient is asking a yes/no question about it (write it as the patient asking);
  negation = the patient is saying it is NOT so (they deny it);
  intensified = the patient is stressing it is severe or strong.
- Facial cues describe what the face did. Use them only to choose how strong the wording is:
  intensified with strong cues = "severe"; intensified with mild cues = "significant".
  Never let the cues change the meaning set by the flag.
- Never mention the face, eyebrows, head movement or the flag in the sentence. The clinician sees those separately.
- If the gloss is unclear, stay literal rather than guessing.
- One sentence, under 25 words, plain clinical English.`;

export interface FaceCues {
  cues: string[];
  strong?: boolean;
}

function describeCues(face: FaceCues) {
  if (face.strong === undefined) return "not measured";
  if (face.cues.length === 0) return "neutral face";
  return `${face.cues.join("; ")} (${face.strong ? "strong" : "mild"})`;
}

// Returns null on any failure or timeout so the caller falls back to the template.
export async function geminiSentence(
  gloss: string[],
  flag: GrammarFlag,
  face: FaceCues,
  cfg: GeminiConfig,
): Promise<string | null> {
  const generationConfig: Record<string, unknown> = {
    temperature: 0.2,
    maxOutputTokens: 200,
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: { sentence: { type: "STRING" } },
      required: ["sentence"],
    },
  };
  // 2.5 models think by default; turning it off keeps latency low.
  if (cfg.model.startsWith("gemini-2.5")) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
        signal: AbortSignal.timeout(cfg.timeoutMs),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Gloss: ${gloss.join(" ")}\nGrammar flag: ${flag}\nFacial cues: ${describeCues(face)}`,
                },
              ],
            },
          ],
          generationConfig,
        }),
      },
    );
    if (!res.ok) {
      console.warn(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const data: any = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const sentence = typeof text === "string" ? JSON.parse(text).sentence : undefined;
    if (typeof sentence !== "string" || !sentence.trim() || sentence.length > 300) return null;
    return sentence.trim();
  } catch (err) {
    console.warn(`Gemini failed, using template: ${(err as Error).message}`);
    return null;
  }
}
