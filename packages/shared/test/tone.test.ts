import { describe, expect, it } from "vitest";
import { spokenParts, voiceTone, type StoredUtterance } from "../src";

const line = (over: Partial<StoredUtterance>): StoredUtterance => ({
  id: "u1",
  ts: new Date().toISOString(),
  encounterId: "e",
  speaker: "patient",
  kind: "sign",
  gloss: ["PAIN", "HEAD"],
  grammarFlag: "statement",
  sentence: "The patient reports a headache.",
  ...over,
});

describe("voice tone from the face", () => {
  it("a plain statement is said in the normal voice", () => {
    const t = voiceTone({ grammarFlag: "statement" });
    expect(t).toMatchObject({ label: "neutral", pitch: 1, rate: 0.95, strong: false });
  });

  it("each facial grammar flag changes the voice in its own direction", () => {
    const base = voiceTone({ grammarFlag: "statement" });
    const q = voiceTone({ grammarFlag: "question" });
    const n = voiceTone({ grammarFlag: "negation" });
    const i = voiceTone({ grammarFlag: "intensified" });
    expect(q.pitch).toBeGreaterThan(base.pitch);
    expect(n.pitch).toBeLessThan(base.pitch);
    expect(n.rate).toBeLessThan(base.rate);
    expect(i.rate).toBeLessThan(base.rate);
    expect(i.volume).toBeGreaterThan(base.volume);
    expect([q.label, n.label, i.label]).toEqual(["questioning", "firm", "emphatic"]);
  });

  it("strong face cues push the tone further", () => {
    const mild = voiceTone({ grammarFlag: "negation", nmm: { headYawFlips: 2 } });
    const strong = voiceTone({ grammarFlag: "negation", nmm: { headYawFlips: 5 } });
    expect(mild.strong).toBe(false);
    expect(strong.strong).toBe(true);
    expect(strong.pitch).toBeLessThan(mild.pitch);
    expect(strong.label).toBe("strongly firm");
    const q = voiceTone({ grammarFlag: "question", nmm: { browUp: 0.5, browHoldMs: 800 } });
    expect(q.label).toBe("strongly questioning");
  });

  it("stays inside the ranges browsers accept", () => {
    for (const grammarFlag of ["statement", "question", "negation", "intensified"] as const) {
      for (const urgent of [false, true]) {
        const t = voiceTone({ grammarFlag, nmm: { headYawFlips: 9, browUp: 1, browHoldMs: 2000, furrowHoldMs: 3000 } }, urgent);
        expect(t.pitch).toBeGreaterThanOrEqual(0);
        expect(t.pitch).toBeLessThanOrEqual(2);
        expect(t.rate).toBeGreaterThan(0.5);
        expect(t.rate).toBeLessThanOrEqual(1.1);
        expect(t.volume).toBeLessThanOrEqual(1);
      }
    }
  });

  it("urgent lines get the urgent prefix, and the confirm reminder is said in a plain voice", () => {
    const parts = spokenParts(line({ gloss: ["PAIN", "CHEST"], grammarFlag: "intensified", sentence: "The patient reports severe chest pain." }));
    expect(parts[0].text).toBe("Urgent. The patient reports severe chest pain.");
    expect(parts[0].tone.volume).toBe(1);
    expect(parts[1]).toMatchObject({ text: "Please confirm with the patient.", tone: { label: "neutral" } });
  });

  it("never changes the words, only how they sound", () => {
    const parts = spokenParts(line({ grammarFlag: "question", sentence: "The patient is asking about a headache." }));
    expect(parts[0].text).toBe("The patient is asking about a headache.");
    expect(parts[0].tone.label).toBe("questioning");
  });
});
