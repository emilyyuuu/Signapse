import { useEffect, useState } from "react";

// The local camera program (apps/pointing) on this computer.
export const CAMERA_URL = (import.meta.env.VITE_CAMERA_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "");

// The signing session in the local camera program (apps/pointing/signs.py). The
// page talks to it on this computer only; it sends sign labels to the server
// itself, never video or hand points.

export interface SigningStatus {
  available: boolean;
  error: string | null;
  signs: string[];
  state: "off" | "watching" | "signing" | "thinking";
  words: { gloss: string | null; confidence: number }[];
  note: string | null;
  sent: string[] | null;
  grammarFlag?: string | null; // what the face said about the last clause sent
  face?: boolean; // facial grammar is running
  seq: number;
}

export type SignAction = "start" | "done" | "cancel";

export async function signing(action: SignAction): Promise<{ ok: boolean; error?: string; gloss?: string[] }> {
  try {
    const res = await fetch(`${CAMERA_URL}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "The camera program isn't answering." };
  }
}

// Polls the camera program while the camera is on: quickly while signing, so
// the words appear as they are recognised, slowly otherwise.
export function useSigning(cameraOn: boolean) {
  const [status, setStatus] = useState<SigningStatus>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!cameraOn) {
      setStatus(undefined);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let next = 1500;
      try {
        const res = await fetch(`${CAMERA_URL}/status`);
        const data = (await res.json()) as { signs?: SigningStatus };
        if (stopped) return;
        setStatus(data.signs);
        if (data.signs && data.signs.state !== "off") next = 300;
      } catch {
        if (!stopped) setStatus(undefined);
      }
      if (!stopped) timer = setTimeout(poll, next);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [cameraOn, tick]);

  const act = async (action: SignAction) => {
    const result = await signing(action);
    setTick((t) => t + 1); // poll again now, not in 1.5 s
    return result;
  };

  return { status, act };
}
