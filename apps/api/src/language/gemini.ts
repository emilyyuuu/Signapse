import type { GrammarFlag } from "@signapse/shared";

export interface GeminiConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxPerMinute: number; // across all clients; over it, callers use their rule-based fallback
}

// Timestamps of recent Gemini calls, for the global per-minute budget. Keeps a
// burst of traffic from exhausting the free-tier quota mid-demo.
const recentCalls: number[] = [];
let budgetWarned = 0;

function takeBudget(cfg: GeminiConfig) {
  const now = Date.now();
  while (recentCalls.length && recentCalls[0] <= now - 60_000) recentCalls.shift();
  if (recentCalls.length >= cfg.maxPerMinute) {
    if (now - budgetWarned > 60_000) {
      console.warn(`Gemini budget of ${cfg.maxPerMinute}/min reached; using rule-based fallback`);
      budgetWarned = now;
    }
    return false;
  }
  recentCalls.push(now);
  return true;
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
- NUM-<n> (NUM-0 to NUM-10) is the patient rating their pain n out of 10; write it as "The patient rates the pain n out of 10." and never change the number.
- POINT-<ZONE> means the patient pointed at or touched that part of their own body. L/R prefixes are the patient's left/right: POINT-LCHEST = left side of the chest, POINT-LKNEE = left knee, POINT-RUQ / LUQ / RLQ / LLQ = right/left upper/lower abdominal quadrant, POINT-NAVEL = around the navel, POINT-REYE = right eye. With BACK, it is the back of that area.
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
  const prompt = `Gloss: ${gloss.join(" ")}\nGrammar flag: ${flag}\nFacial cues: ${describeCues(face)}`;
  const sentence = await geminiText(INSTRUCTIONS, prompt, 200, cfg.timeoutMs, cfg);
  return sentence && sentence.length <= 300 ? sentence : null;
}

const SUMMARY_INSTRUCTIONS = `You write a short summary at the top of a clinical chart note for a Deaf patient's emergency visit.
The input is the visit log: sentences translated from the patient's sign language, the clinician's replies, the patient's yes/no answers, and pain-map readings.
Rules:
- 2 to 3 sentences, plain clinical English.
- Use only facts in the log. Never add diagnoses, causes, vital signs, history or advice.
- Include what the patient denied, not only what they reported.
- Lines marked UNCONFIRMED must be described as unconfirmed.
- No names; refer to "the patient".`;

// Short summary paragraph for the chart note. A visit log is longer than one
// clause and nobody is waiting on it live, so it gets a longer timeout.
export async function geminiNoteSummary(visitLog: string, cfg: GeminiConfig): Promise<string | null> {
  const summary = await geminiText(SUMMARY_INSTRUCTIONS, visitLog, 400, cfg.timeoutMs * 3, cfg);
  return summary && summary.length <= 1200 ? summary : null;
}

// One Gemini call returning {"text": "..."}. Returns null on any failure or
// timeout so callers fall back to their rule-based output.
async function geminiText(
  instructions: string,
  prompt: string,
  maxOutputTokens: number,
  timeoutMs: number,
  cfg: GeminiConfig,
): Promise<string | null> {
  if (!takeBudget(cfg)) return null;
  const generationConfig: Record<string, unknown> = {
    temperature: 0.2,
    maxOutputTokens,
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: { text: { type: "STRING" } },
      required: ["text"],
    },
  };
  // 2.5 models think by default; turning it off keeps latency low.
  if (cfg.model.startsWith("gemini-2.5")) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  try {
    const res = await fetch(
      `${process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com"}/v1beta/models/${cfg.model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig,
        }),
      },
    );
    if (!res.ok) {
      console.warn(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const data: any = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const text = typeof raw === "string" ? JSON.parse(raw).text : undefined;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch (err) {
    console.warn(`Gemini failed, using fallback: ${(err as Error).message}`);
    return null;
  }
}
