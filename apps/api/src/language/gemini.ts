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
- Apply the grammar flag from the patient's face:
  statement = the patient is telling you this;
  question = the patient is asking a yes/no question about it;
  negation = the patient is saying it is NOT so (denies it);
  intensified = the patient is stressing it is severe or strong.
- If the gloss is unclear, stay literal rather than guessing.
- One sentence, under 25 words, plain clinical English.`;

// Returns null on any failure or timeout so the caller falls back to the template.
export async function geminiSentence(
  gloss: string[],
  flag: GrammarFlag,
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
          contents: [{ role: "user", parts: [{ text: `Gloss: ${gloss.join(" ")}\nGrammar flag: ${flag}` }] }],
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
