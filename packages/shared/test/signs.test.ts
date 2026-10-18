import { describe, expect, it } from "vitest";
import {
  assessPriority,
  isAllowedSign,
  keepsSigns,
  painReadingOf,
  patientSentence,
  signText,
  templateSentence,
} from "../src";

// The recorded-sign model's words: chest, face, fever, headache, jaw, nausea, pain, stomach.
describe("signs from the recorded sign model", () => {
  it("HEADACHE on its own is a headache, like PAIN HEAD", () => {
    expect(templateSentence(["HEADACHE"], "statement")).toBe("The patient reports a headache.");
    expect(templateSentence(["PAIN", "HEAD"], "statement")).toBe("The patient reports a headache.");
    expect(templateSentence(["HEADACHE"], "negation")).toBe("The patient denies a headache.");
    expect(patientSentence(["HEADACHE"], "statement")).toBe("You said: I have a headache.");
  });

  it("FACE and JAW are places for pain", () => {
    expect(templateSentence(["PAIN", "FACE"], "statement")).toBe("The patient reports facial pain.");
    expect(templateSentence(["PAIN", "JAW"], "statement")).toBe("The patient reports jaw pain.");
    expect(templateSentence(["JAW", "PAIN"], "question")).toBe("The patient is asking about jaw pain.");
  });

  it("keeps the old meanings of the other words", () => {
    expect(templateSentence(["PAIN", "CHEST"], "statement")).toBe("The patient reports chest pain.");
    expect(templateSentence(["PAIN", "STOMACH"], "statement")).toBe("The patient reports abdominal pain.");
    expect(templateSentence(["FEVER"], "statement")).toBe("The patient reports a fever.");
    expect(templateSentence(["NAUSEA"], "statement")).toBe("The patient reports nausea.");
    expect(templateSentence(["PAIN"], "statement")).toBe("The patient reports pain.");
  });

  it("keeps every symptom that was signed", () => {
    expect(templateSentence(["NAUSEA", "FEVER"], "statement")).toBe("The patient reports nausea and a fever.");
    expect(patientSentence(["NAUSEA", "FEVER"], "statement")).toBe("You said: I have nausea and a fever.");
    expect(templateSentence(["FEVER", "NAUSEA"], "negation")).toBe("The patient denies a fever and nausea.");
    expect(templateSentence(["PAIN", "STOMACH", "NAUSEA"], "statement")).toBe("The patient reports abdominal pain and nausea.");
    expect(templateSentence(["PAIN", "POINT-LCHEST", "NAUSEA", "FEVER"], "statement")).toBe(
      "The patient reports left chest pain, nausea and a fever.",
    );
    // Chest pain is still urgent with other symptoms alongside.
    expect(assessPriority(["PAIN", "CHEST", "NAUSEA"], "statement")).toBe("urgent");
  });

  it("after signing PAIN, tapping the body adds where", () => {
    expect(patientSentence(["PAIN"], "statement")).toBe("You said: I have pain.");
    expect(patientSentence(["PAIN", "POINT-LCHEST"], "statement")).toBe("You said: I have left chest pain.");
    expect(assessPriority(["PAIN", "POINT-LCHEST"], "statement")).toBe("urgent");
    expect(templateSentence(["PAIN", "POINT-RKNEE"], "statement")).toBe("The patient reports right knee pain.");
  });

  it("the patient's 0-10 rating goes into both sentences and the pain map", () => {
    const gloss = ["PAIN", "POINT-LCHEST", "NUM-7"];
    expect(patientSentence(gloss, "statement")).toBe("You said: I have left chest pain. It is 7 out of 10.");
    expect(templateSentence(gloss, "statement")).toBe("The patient reports left chest pain, rated 7 out of 10.");
    expect(painReadingOf(gloss)).toEqual({ zone: "lchest", severity: 7 });
    expect(painReadingOf(["PAIN", "STOMACH", "NUM-4"])).toEqual({ zone: "abdomen", severity: 4 });
    expect(painReadingOf(["PAIN", "NUM-4"])).toBeUndefined(); // no place yet
    expect(painReadingOf(["NAUSEA", "FEVER"])).toBeUndefined();
    // Once rated, the patient's answer is the meaning, whatever the face looked like.
    expect(templateSentence(["PAIN", "POINT-LCHEST", "NUM-7"], "negation")).toBe(
      "The patient reports left chest pain, rated 7 out of 10.",
    );
  });

  it("the rating decides urgency, not the face: 8-10 urgent anywhere, 1-2 not", () => {
    // The reported bug: frowning while signing HEADACHE made 1 and 2 urgent...
    for (const face of ["statement", "intensified", "question", "negation"] as const) {
      expect(assessPriority(["HEADACHE", "NUM-1"], face)).toBe("routine");
      expect(assessPriority(["HEADACHE", "NUM-2"], face)).toBe("routine");
      // ...and a head shake or raised brows made 10 not urgent.
      expect(assessPriority(["HEADACHE", "NUM-10"], face)).toBe("urgent");
      expect(assessPriority(["PAIN", "POINT-RKNEE", "NUM-10"], face)).toBe("urgent");
    }
    expect(assessPriority(["PAIN", "POINT-RUQ", "NUM-8"], "statement")).toBe("urgent");
    expect(assessPriority(["PAIN", "POINT-RUQ", "NUM-7"], "statement")).toBe("routine");
    expect(patientSentence(["HEADACHE", "NUM-2"], "intensified")).toBe("You said: I have a headache. It is 2 out of 10.");
    expect(templateSentence(["HEADACHE", "NUM-2"], "intensified")).toBe("The patient reports a headache, rated 2 out of 10.");
  });

  it("chest pain is urgent at any rating above 0", () => {
    expect(assessPriority(["PAIN", "POINT-LCHEST", "NUM-1"], "statement")).toBe("urgent");
    expect(assessPriority(["PAIN", "POINT-LCHEST", "NUM-1"], "negation")).toBe("urgent");
    expect(assessPriority(["PAIN", "POINT-LCHEST", "NUM-0"], "statement")).toBe("routine");
  });

  it("spots a written sentence that dropped part of the signs", () => {
    expect(keepsSigns(["HEADACHE", "NUM-2"], "The patient rates the pain 2 out of 10.")).toBe(false); // lost the headache
    expect(keepsSigns(["HEADACHE", "NUM-2"], "The patient reports a headache, rated 2 out of 10.")).toBe(true);
    expect(keepsSigns(["HEADACHE", "NUM-2"], "The patient reports a headache, rated 3 out of 10.")).toBe(false); // wrong number
    expect(keepsSigns(["PAIN", "POINT-LCHEST", "NUM-7"], "The patient reports pain at the left side of the chest, 7 out of 10.")).toBe(true);
    expect(keepsSigns(["PAIN", "POINT-LCHEST", "NUM-7"], "The patient reports right chest pain, 7 out of 10.")).toBe(false); // wrong side
    expect(keepsSigns(["NAUSEA", "FEVER"], "The patient reports nausea.")).toBe(false);
    expect(keepsSigns(["NAUSEA", "FEVER"], "The patient reports feeling sick and a fever.")).toBe(true);
    expect(keepsSigns(["PAIN", "STOMACH"], "The patient reports abdominal pain.")).toBe(true);
  });

  it("every box the patient can tap has wording for them and the doctor", () => {
    for (const t of ["VOMIT", "COUGH", "CHILLS", "TIRED", "WEAK", "FAINT", "NUMB", "RASH", "ITCH", "SWELLING", "BLEEDING", "DIARRHEA", "ALLERGY", "ANXIOUS"]) {
      expect(isAllowedSign(t)).toBe(true);
      const doctor = templateSentence([t], "statement");
      expect(doctor).toMatch(/^The patient reports .+\.$/);
      expect(keepsSigns([t], doctor)).toBe(true);
      expect(patientSentence([t], "statement")).toMatch(/^You said: I have .+\.$/);
    }
    expect(templateSentence(["VOMIT", "DIARRHEA"], "statement")).toBe("The patient reports vomiting and diarrhea.");
    expect(patientSentence(["ALLERGY"], "statement")).toBe("You said: I have an allergic reaction.");
  });

  it("HEARTATTACK (a recorded sign) is worded and urgent, even with other symptoms", () => {
    expect(templateSentence(["HEARTATTACK"], "statement")).toBe("The patient reports signs of a heart attack.");
    expect(patientSentence(["HEARTATTACK"], "statement")).toBe("You said: I have signs of a heart attack.");
    expect(assessPriority(["HEARTATTACK"], "statement")).toBe("urgent");
    expect(assessPriority(["NAUSEA", "HEARTATTACK"], "statement")).toBe("urgent");
    expect(assessPriority(["HEARTATTACK"], "negation")).toBe("routine"); // "no heart attack"
    expect(signText("HEARTATTACK")).toBe("Heart attack");
  });

  it("before a rating, the face still counts", () => {
    expect(assessPriority(["HEADACHE"], "intensified")).toBe("urgent");
    expect(assessPriority(["PAIN", "CHEST"], "negation")).toBe("routine");
    expect(templateSentence(["PAIN", "CHEST"], "negation")).toBe("The patient denies chest pain.");
  });

  it("a pointed place still beats a signed one", () => {
    expect(templateSentence(["HEADACHE", "POINT-JAW"], "statement")).toBe("The patient reports jaw pain.");
  });

  it("triage treats HEADACHE like PAIN", () => {
    expect(assessPriority(["HEADACHE"], "intensified")).toBe("urgent"); // severe central pain
    expect(assessPriority(["HEADACHE"], "statement")).toBe("routine");
    expect(assessPriority(["PAIN", "CHEST"], "statement")).toBe("urgent");
    expect(assessPriority(["PAIN", "JAW"], "intensified")).toBe("routine"); // not central
  });

  it("the patient can pick the new words when editing", () => {
    for (const t of ["HEADACHE", "FACE", "JAW", "PAIN", "CHEST", "STOMACH", "FEVER", "NAUSEA"]) {
      expect(isAllowedSign(t)).toBe(true);
    }
    expect(signText("HEADACHE")).toBe("Headache");
    expect(signText("JAW")).toBe("Jaw");
  });
});
