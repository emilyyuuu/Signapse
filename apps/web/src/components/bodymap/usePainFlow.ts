import { useState } from "react";
import { signedLevel, viewOf, type BodyView, type RoomMessage } from "@signapse/shared";
import { usePainMap } from "./usePainMap";
import { usePointing } from "./usePointing";

// The patient's side of reporting pain, shared by the patient station and the
// patient's call screen. Tap a body part, or point at it with the camera and
// nod (or tap Yes) to confirm, then pick 0–10. A signed number sets the level
// for the selected part. Pass every room message to handle().
export function usePainFlow(encounterId: string) {
  const { pain, apply, report } = usePainMap(encounterId);
  const [view, setView] = useState<BodyView>("front");
  const [selected, setSelected] = useState<string>();
  const [sendFailed, setSendFailed] = useState(false);
  const { pointed, handle: handlePoint, clear: clearPoint } = usePointing();
  // The selection came from the camera, so the reading is saved as "pointing".
  const [fromPointing, setFromPointing] = useState(false);
  // Set when the level came from a signed number, so the patient can check it.
  const [signed, setSigned] = useState<{ zone: string; level: number }>();

  // One tap sets the level and closes the picker; the map shows the result.
  const pick = async (severity: number) => {
    if (!selected) return;
    const zone = selected;
    const source = fromPointing ? "pointing" : "tap";
    setSelected(undefined);
    setFromPointing(false);
    clearPoint();
    setSendFailed(!(await report(zone, severity, source)));
  };

  // Nod, or the Yes button: the body part the camera found is right, so ask for the number.
  const confirmPointed = () => {
    if (!pointed) return;
    setSelected(pointed.zone);
    setFromPointing(true);
  };

  // Shake, or the No button: that was not it. Clear it so the patient can point again.
  const cancelPointed = () => {
    clearPoint();
    if (fromPointing) setSelected(undefined);
    setFromPointing(false);
  };

  // Tapping another zone corrects a misread point.
  const tap = (zone: string) => {
    clearPoint();
    setSigned(undefined);
    setSelected(zone);
    setFromPointing(false);
  };

  // Keeps the map in sync with other devices and the camera. Pointing at a
  // body part shows what the camera found; a nod confirms it.
  const handle = (msg: RoomMessage) => {
    if (msg.type === "pain") apply(msg.data);
    // A signed number sets the level for the body part that is selected.
    if (msg.type === "utterance" && msg.data.speaker === "patient" && msg.data.gloss && selected) {
      const level = signedLevel(msg.data.gloss);
      if (level !== undefined) {
        setSigned({ zone: selected, level });
        void pick(level);
        return;
      }
    }
    const zone = handlePoint(msg);
    if (zone) {
      setView(viewOf(zone));
      setSelected(undefined);
      setFromPointing(false);
    }
    if (msg.type === "gesture") {
      if (msg.data.gesture === "nod" && pointed && !selected) confirmPointed();
      if (msg.data.gesture === "shake") cancelPointed();
    }
  };

  return {
    pain,
    view,
    setView,
    selected,
    pointed,
    fromPointing,
    signed,
    sendFailed,
    pick,
    confirmPointed,
    cancelPointed,
    tap,
    handle,
  };
}
