import { describe, expect, it } from "vitest";
import {
  ZONE_IDS,
  assessPriority,
  complaintOf,
  painPriority,
  pointGloss,
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
