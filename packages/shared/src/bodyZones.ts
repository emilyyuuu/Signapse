// Body-map zones shared by the patient screen, the clinician screen, the API and
// apps/pointing (zones.py). Front and back use a 200 x 414 SVG viewBox, the face
// view 120 x 140. Front and face are drawn facing the viewer, so the patient's
// right side is on the viewer's left.

export type BodyView = "front" | "back" | "face";

export interface ZoneShape {
  id: string;
  label: string;
  shape: "ellipse" | "rect";
  x: number; // ellipse: centre; rect: top-left
  y: number;
  w: number; // ellipse: x radius; rect: width
  h: number;
  r?: number; // rect corner radius
}

export const VIEW_BOXES: Record<BodyView, { w: number; h: number }> = {
  front: { w: 200, h: 414 },
  back: { w: 200, h: 414 },
  face: { w: 120, h: 140 },
};

const VIEW_WIDTH = 200;

const LIMBS: ZoneShape[] = [
  { id: "rshoulder", label: "Right shoulder", shape: "rect", x: 42, y: 82, w: 20, h: 22, r: 8 },
  { id: "lshoulder", label: "Left shoulder", shape: "rect", x: 138, y: 82, w: 20, h: 22, r: 8 },
  { id: "rupperarm", label: "Right upper arm", shape: "rect", x: 36, y: 106, w: 18, h: 50, r: 8 },
  { id: "lupperarm", label: "Left upper arm", shape: "rect", x: 146, y: 106, w: 18, h: 50, r: 8 },
  { id: "rforearm", label: "Right forearm", shape: "rect", x: 28, y: 158, w: 18, h: 56, r: 8 },
  { id: "lforearm", label: "Left forearm", shape: "rect", x: 154, y: 158, w: 18, h: 56, r: 8 },
  { id: "rhand", label: "Right hand", shape: "rect", x: 24, y: 216, w: 18, h: 22, r: 8 },
  { id: "lhand", label: "Left hand", shape: "rect", x: 158, y: 216, w: 18, h: 22, r: 8 },
  { id: "rthigh", label: "Right thigh", shape: "rect", x: 66, y: 208, w: 32, h: 74, r: 12 },
  { id: "lthigh", label: "Left thigh", shape: "rect", x: 102, y: 208, w: 32, h: 74, r: 12 },
  { id: "rknee", label: "Right knee", shape: "rect", x: 68, y: 284, w: 28, h: 22, r: 8 },
  { id: "lknee", label: "Left knee", shape: "rect", x: 104, y: 284, w: 28, h: 22, r: 8 },
  { id: "rshin", label: "Right lower leg", shape: "rect", x: 68, y: 308, w: 28, h: 74, r: 10 },
  { id: "lshin", label: "Left lower leg", shape: "rect", x: 104, y: 308, w: 28, h: 74, r: 10 },
  { id: "rfoot", label: "Right foot", shape: "rect", x: 66, y: 384, w: 32, h: 22, r: 8 },
  { id: "lfoot", label: "Left foot", shape: "rect", x: 102, y: 384, w: 32, h: 22, r: 8 },
];

const FRONT_TORSO: ZoneShape[] = [
  { id: "head", label: "Head", shape: "ellipse", x: 100, y: 38, w: 22, h: 27 },
  { id: "neck", label: "Neck", shape: "rect", x: 90, y: 64, w: 20, h: 16, r: 6 },
  { id: "rchest", label: "Right chest", shape: "rect", x: 64, y: 82, w: 36, h: 46, r: 12 },
  { id: "lchest", label: "Left chest", shape: "rect", x: 100, y: 82, w: 36, h: 46, r: 12 },
  { id: "ruq", label: "Right upper abdomen", shape: "rect", x: 68, y: 130, w: 32, h: 20, r: 8 },
  { id: "luq", label: "Left upper abdomen", shape: "rect", x: 100, y: 130, w: 32, h: 20, r: 8 },
  { id: "rlq", label: "Right lower abdomen", shape: "rect", x: 68, y: 150, w: 32, h: 20, r: 8 },
  { id: "llq", label: "Left lower abdomen", shape: "rect", x: 100, y: 150, w: 32, h: 20, r: 8 },
  // Middle of the abdomen (around the navel), drawn on top of the four quadrants.
  { id: "navel", label: "Around the navel", shape: "ellipse", x: 100, y: 150, w: 9, h: 9 },
  { id: "pelvis", label: "Pelvis", shape: "rect", x: 66, y: 172, w: 68, h: 32, r: 12 },
];

const BACK_TORSO: ZoneShape[] = [
  { id: "headback", label: "Back of head", shape: "ellipse", x: 100, y: 38, w: 22, h: 27 },
  { id: "neckback", label: "Back of neck", shape: "rect", x: 90, y: 64, w: 20, h: 16, r: 6 },
  { id: "rupperback", label: "Right upper back", shape: "rect", x: 64, y: 82, w: 36, h: 46, r: 12 },
  { id: "lupperback", label: "Left upper back", shape: "rect", x: 100, y: 82, w: 36, h: 46, r: 12 },
  { id: "rlowerback", label: "Right lower back", shape: "rect", x: 68, y: 130, w: 32, h: 40, r: 10 },
  { id: "llowerback", label: "Left lower back", shape: "rect", x: 100, y: 130, w: 32, h: 40, r: 10 },
  { id: "buttocks", label: "Buttocks", shape: "rect", x: 66, y: 172, w: 68, h: 32, r: 12 },
];

// Close-up of the face for pain the body view is too small to show.
const FACE: ZoneShape[] = [
  { id: "forehead", label: "Forehead", shape: "rect", x: 30, y: 22, w: 60, h: 20, r: 10 },
  { id: "reye", label: "Right eye", shape: "ellipse", x: 44, y: 52, w: 10, h: 6 },
  { id: "leye", label: "Left eye", shape: "ellipse", x: 76, y: 52, w: 10, h: 6 },
  { id: "nose", label: "Nose", shape: "rect", x: 53, y: 58, w: 14, h: 22, r: 6 },
  { id: "rcheek", label: "Right cheek", shape: "ellipse", x: 35, y: 78, w: 10, h: 10 },
  { id: "lcheek", label: "Left cheek", shape: "ellipse", x: 85, y: 78, w: 10, h: 10 },
  { id: "mouth", label: "Mouth", shape: "ellipse", x: 60, y: 92, w: 14, h: 6 },
  { id: "jaw", label: "Jaw", shape: "rect", x: 40, y: 104, w: 40, h: 16, r: 8 },
  { id: "rear", label: "Right ear", shape: "ellipse", x: 11, y: 68, w: 6, h: 12 },
  { id: "lear", label: "Left ear", shape: "ellipse", x: 109, y: 68, w: 6, h: 12 },
];

// Seen from behind, the patient's right side is on the viewer's right.
// Ellipses are positioned by their centre, rects by their top-left corner.
const mirror = (z: ZoneShape): ZoneShape => ({
  ...z,
  x: z.shape === "ellipse" ? VIEW_WIDTH - z.x : VIEW_WIDTH - z.x - z.w,
});

export const BODY_VIEWS: Record<BodyView, ZoneShape[]> = {
  front: [...FRONT_TORSO, ...LIMBS],
  back: [...BACK_TORSO, ...LIMBS].map(mirror),
  face: FACE,
};

// Coarse zones that are not drawn on their own. A signed CHEST (no side) or an
// older reading lands here and lights up every part of the group.
const GROUPS: Record<string, { label: string; parts: string[] }> = {
  chest: { label: "Chest", parts: ["rchest", "lchest"] },
  abdomen: { label: "Abdomen", parts: ["ruq", "luq", "rlq", "llq", "navel"] },
  upperback: { label: "Upper back", parts: ["rupperback", "lupperback"] },
  lowerback: { label: "Lower back", parts: ["rlowerback", "llowerback"] },
};

// Fine zone -> the coarser region it belongs to (used for triage and highlighting).
export const ZONE_PARENT: Record<string, string> = {
  ...Object.fromEntries(Object.entries(GROUPS).flatMap(([g, { parts }]) => parts.map((p) => [p, g]))),
  ...Object.fromEntries(FACE.map((z) => [z.id, "head"])),
};

export const ZONE_LABELS: Record<string, string> = {
  ...Object.fromEntries([...FRONT_TORSO, ...BACK_TORSO, ...LIMBS, ...FACE].map((z) => [z.id, z.label])),
  ...Object.fromEntries(Object.entries(GROUPS).map(([g, { label }]) => [g, label])),
};

export const ZONE_IDS = Object.keys(ZONE_LABELS) as [string, ...string[]];

const drawnIn = (view: BodyView, zone: string) => BODY_VIEWS[view].some((z) => z.id === zone);

// True when a reading or highlight on `zone` should show on the drawn zone `drawn`:
// the same zone, a group it belongs to (chest -> both halves), or a part this view
// doesn't draw (nose -> the head on the body view).
export function zoneCovers(drawn: string, zone: string, view: BodyView): boolean {
  if (drawn === zone || GROUPS[zone]?.parts.includes(drawn)) return true;
  return ZONE_PARENT[zone] === drawn && !drawnIn(view, zone);
}

// The view that shows a zone best: where it is drawn, or where its parts are.
export function viewOf(zone: string): BodyView {
  const parts = GROUPS[zone]?.parts ?? [zone];
  return (["front", "back", "face"] as const).find((v) => parts.some((p) => drawnIn(v, p))) ?? "front";
}
