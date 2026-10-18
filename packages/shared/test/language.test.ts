import { describe, expect, it } from "vitest";
import {
  ZONE_IDS,
  assessPriority,
  complaintOf,
  painPriority,
  pointGloss,
  buildChartNote,
  cleanName,
  isAllowedSign,
  mentionsName,
  visitLog,
  visitName,
  patientFaceLine,
  patientSentence,
  pointedZone,
  signedLevel,
  templateSentence,
  viewOf,
  zoneCovers,
} from "../src";

describe("pointing in the gloss", () => {
  it("pointing gives the zone and complaint", () => {
    expect(complaintOf(["PAIN", "POINT-CHEST"])).toEqual({ complaint: "chest pain", zone: "chest" });
    expect(complaintOf(["PAIN", "POINT-LKNEE"])).toEqual({ complaint: "left knee pain", zone: "lknee" });
    expect(complaintOf(["PAIN", "POINT-ABDOMEN"]).complaint).toBe("abdominal pain");
    expect(complaintOf(["PAIN", "POINT-HEAD"]).complaint).toBe("a headache");
  });

  it("pointing beats a signed location", () => {
    expect(complaintOf(["PAIN", "HEAD", "POINT-CHEST"]).zone).toBe("chest");
  });

  it("BACK turns a front zone into its back", () => {
    expect(complaintOf(["PAIN", "BACK", "POINT-ABDOMEN"])).toEqual({ complaint: "lower back pain", zone: "lowerback" });
    expect(pointedZone(["BACK", "POINT-CHEST"])).toBe("upperback");
    expect(pointedZone(["BACK", "POINT-LKNEE"])).toBe("lknee");
  });

  it("unknown zones are ignored", () => {
    expect(pointedZone(["PAIN", "POINT-ELBOW"])).toBeUndefined();
  });

  it("sentences read naturally", () => {
    expect(templateSentence(["PAIN", "POINT-CHEST"], "intensified")).toBe("The patient reports severe chest pain.");
    expect(templateSentence(["POINT-RSHOULDER"], "statement")).toBe("The patient points to the right shoulder.");
    expect(templateSentence(["ITCH", "POINT-LHAND"], "statement")).toBe(
      "The patient signed: ITCH, pointing to the left hand.",
    );
  });

  it("pointed chest pain is urgent like signed chest pain", () => {
    expect(assessPriority(["PAIN", "POINT-CHEST"], "statement")).toBe("urgent");
  });

  it("every zone token fits the API gloss rule", () => {
    for (const z of ZONE_IDS) expect(pointGloss(z)).toMatch(/^[A-Z][A-Z0-9-]{0,24}$/);
  });
});

describe("finer zones", () => {
  it("sides, quadrants and face parts read naturally", () => {
    expect(complaintOf(["PAIN", "POINT-LCHEST"])).toEqual({ complaint: "left chest pain", zone: "lchest" });
    expect(complaintOf(["PAIN", "POINT-RLQ"]).complaint).toBe("right lower abdominal pain");
    expect(complaintOf(["PAIN", "POINT-NAVEL"]).complaint).toBe("pain around the navel");
    expect(complaintOf(["PAIN", "POINT-REYE"]).complaint).toBe("right eye pain");
  });

  it("chest pain on either side is still a red flag", () => {
    expect(assessPriority(["PAIN", "POINT-LCHEST"], "statement")).toBe("urgent");
    expect(assessPriority(["PAIN", "CHEST"], "statement")).toBe("urgent");
    expect(assessPriority(["PAIN", "POINT-LCHEST"], "negation")).toBe("routine");
  });

  it("severe central pain uses the region", () => {
    expect(painPriority("luq", 9)).toBe("urgent");
    expect(painPriority("forehead", 9)).toBe("urgent");
    expect(painPriority("nose", 9)).toBe("routine");
    expect(painPriority("lchest", 5)).toBe("routine");
  });

  it("BACK maps sides and quadrants to the matching back zone", () => {
    expect(pointedZone(["BACK", "POINT-LCHEST"])).toBe("lupperback");
    expect(pointedZone(["BACK", "POINT-RLQ"])).toBe("rlowerback");
    expect(pointedZone(["BACK", "POINT-NOSE"])).toBe("headback");
  });
});

describe("body map coverage", () => {
  it("groups light their parts and hidden parts light their parent", () => {
    expect(zoneCovers("lchest", "chest", "front")).toBe(true);
    expect(zoneCovers("ruq", "abdomen", "front")).toBe(true);
    expect(zoneCovers("head", "nose", "front")).toBe(true);
    expect(zoneCovers("nose", "head", "face")).toBe(false); // a headache doesn't colour the nose
    expect(zoneCovers("lchest", "rchest", "front")).toBe(false);
  });

  it("picks the view that shows a zone", () => {
    expect(viewOf("nose")).toBe("face");
    expect(viewOf("chest")).toBe("front");
    expect(viewOf("lowerback")).toBe("back");
    expect(viewOf("lknee")).toBe("front");
  });
});

describe("signed pain level", () => {
  it("reads NUM-0 to NUM-10 and nothing else", () => {
    expect(signedLevel(["NUM-0"])).toBe(0);
    expect(signedLevel(["NUM-7"])).toBe(7);
    expect(signedLevel(["NUM-10"])).toBe(10);
    expect(signedLevel(["PAIN", "NUM-3"])).toBe(3);
    expect(signedLevel(["NUM-11"])).toBeUndefined();
    expect(signedLevel(["NUM-"])).toBeUndefined();
    expect(signedLevel(["NUMBER-7"])).toBeUndefined();
    expect(signedLevel(["PAIN", "CHEST"])).toBeUndefined();
  });

  it("writes a plain sentence for a lone number", () => {
    expect(templateSentence(["NUM-7"], "statement")).toBe("The patient rates the pain 7 out of 10.");
    // A real complaint keeps its normal sentence.
    expect(templateSentence(["PAIN", "CHEST", "NUM-7"], "statement")).toMatch(/chest pain/);
  });
});

describe("what the patient reads before sending", () => {
  it("restates the signs in short first-person sentences", () => {
    expect(patientSentence(["PAIN", "CHEST"], "statement")).toBe("You said: I have chest pain.");
    expect(patientSentence(["PAIN", "CHEST"], "question")).toBe("You asked about chest pain.");
    expect(patientSentence(["PAIN", "CHEST"], "negation")).toBe("You said no. You do not have chest pain.");
    expect(patientSentence(["PAIN", "HEAD"], "intensified")).toBe("You said it is very bad: a headache.");
    expect(patientSentence(["NO"], "statement")).toBe("You said no.");
    expect(patientSentence(["NUM-7"], "statement")).toBe("You rate your pain 7 out of 10.");
  });

  it("names the body part the patient pointed at", () => {
    expect(patientSentence(["PAIN", "POINT-LCHEST"], "statement")).toMatch(/left chest/);
  });

  it("falls back to listing the signs when nothing is understood", () => {
    expect(patientSentence(["PAIN"], "statement")).toBe("You said: I have pain.");
    expect(patientSentence(["WATER"], "statement")).toBe("You signed: Water.");
  });

  it("says what the face showed", () => {
    expect(patientFaceLine("question")).toMatch(/question/);
    expect(patientFaceLine("negation")).toMatch(/no/);
    expect(patientFaceLine("intensified")).toMatch(/strong/);
    expect(patientFaceLine("statement")).toMatch(/statement/);
  });

  it("only accepts known signs when the patient edits", () => {
    expect(isAllowedSign("PAIN")).toBe(true);
    expect(isAllowedSign("POINT-LCHEST")).toBe(true);
    expect(isAllowedSign("NUM-7")).toBe(true);
    expect(isAllowedSign("POINT-ELBOWISH")).toBe(false);
    expect(isAllowedSign("NUM-11")).toBe(false);
    expect(isAllowedSign("DROP-TABLE")).toBe(false);
  });
});

describe("patient name", () => {
  it("accepts real names and rejects anything that is not a name", () => {
    expect(cleanName("  Jordan   Demo ")).toBe("Jordan Demo");
    expect(cleanName("María-José O'Brien")).toBe("María-José O'Brien");
    expect(cleanName("李 小龍")).toBe("李 小龍");
    for (const bad of ["", "   ", "12345", "<b>Sam</b>", "Sam; DROP TABLE x", "A".repeat(61), "-Sam"]) {
      expect(cleanName(bad)).toBeUndefined();
    }
  });

  it("spots the name, or part of it, as a word in text", () => {
    expect(mentionsName("Jordan reports chest pain", "Jordan Demo")).toBe(true);
    expect(mentionsName("the DEMO visit", "Jordan Demo")).toBe(true);
    expect(mentionsName("The patient reports chest pain", "Jordan Demo")).toBe(false);
    // Part of a longer word is not the name.
    expect(mentionsName("Sam was seen", "Sam Lee")).toBe(true);
    expect(mentionsName("the same pain", "Sam Lee")).toBe(false);
    expect(mentionsName("anything", undefined)).toBe(false);
  });

  it("falls back to the token when there is no name", () => {
    expect(visitName({ patientName: "Jordan Demo", patientRef: "PT-1" })).toBe("Jordan Demo");
    expect(visitName({ patientRef: "PT-1" })).toBe("PT-1");
  });

  it("keeps the name out of the text built for the AI summary", () => {
    const encounter = {
      encounterId: "e",
      patientRef: "PT-1",
      patientName: "Quillfeather Zephyrine",
      clinicianId: "clinician",
      signLanguage: "ASL",
      startedAt: new Date().toISOString(),
    };
    const note = buildChartNote(encounter, [], []);
    expect(note.encounter.patientName).toBe("Quillfeather Zephyrine"); // the note itself shows it to the clinician
    expect(mentionsName(visitLog(note), encounter.patientName)).toBe(false); // the AI text never does
  });
});
