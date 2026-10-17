// Body-map zones shared by the patient screen, the clinician screen and the API.
// Coordinates are in a 200 x 414 SVG viewBox. Front view is drawn facing the
// viewer, so the patient's right side is on the viewer's left.

export type BodyView = "front" | "back";

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
  { id: "chest", label: "Chest", shape: "rect", x: 64, y: 82, w: 72, h: 46, r: 14 },
  { id: "abdomen", label: "Abdomen", shape: "rect", x: 68, y: 130, w: 64, h: 40, r: 10 },
  { id: "pelvis", label: "Pelvis", shape: "rect", x: 66, y: 172, w: 68, h: 32, r: 12 },
];

const BACK_TORSO: ZoneShape[] = [
  { id: "headback", label: "Back of head", shape: "ellipse", x: 100, y: 38, w: 22, h: 27 },
  { id: "neckback", label: "Back of neck", shape: "rect", x: 90, y: 64, w: 20, h: 16, r: 6 },
  { id: "upperback", label: "Upper back", shape: "rect", x: 64, y: 82, w: 72, h: 46, r: 14 },
  { id: "lowerback", label: "Lower back", shape: "rect", x: 68, y: 130, w: 64, h: 40, r: 10 },
  { id: "buttocks", label: "Buttocks", shape: "rect", x: 66, y: 172, w: 68, h: 32, r: 12 },
];

// Seen from behind, the patient's right side is on the viewer's right.
const mirror = (z: ZoneShape): ZoneShape => ({ ...z, x: VIEW_WIDTH - z.x - z.w });

export const BODY_VIEWS: Record<BodyView, ZoneShape[]> = {
  front: [...FRONT_TORSO, ...LIMBS],
  back: [...BACK_TORSO, ...LIMBS.map(mirror)],
};

export const ZONE_LABELS: Record<string, string> = Object.fromEntries(
  [...FRONT_TORSO, ...BACK_TORSO, ...LIMBS].map((z) => [z.id, z.label]),
);

export const ZONE_IDS = Object.keys(ZONE_LABELS) as [string, ...string[]];
