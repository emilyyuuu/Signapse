import { useEffect, useState } from "react";
import { CAMERA_URL } from "../../lib/api";

// Recording new sign examples in the local camera program (apps/pointing/recorder.py).
// Only hand points are saved, on this computer.

export interface RebuildResult {
  state: "idle" | "running" | "done" | "failed";
  error?: string;
  backup?: string | null;
  examples?: number;
  correct?: number;
  perSign?: Record<string, { correct: number; total: number }>;
  mixedUp?: Record<string, number>;
}

export interface RecordStatus {
  state: "off" | "waiting" | "recording";
  sign: string | null;
  frames: number;
  note: string | null;
  lastSaved: string | null;
  counts: Record<string, number>;
  rebuild: RebuildResult;
  seq: number;
}

async function post(path: string, body: object): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${CAMERA_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "The camera program isn't answering." };
  }
}

export const startRecording = (sign: string) => post("/record", { action: "start", sign });
export const cancelRecording = () => post("/record", { action: "cancel" });
export const rebuildModel = () => post("/rebuild", {});

// Polls the camera program while the page is open.
export function useRecording() {
  const [status, setStatus] = useState<RecordStatus>();
  const [signs, setSigns] = useState<string[]>([]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await (await fetch(`${CAMERA_URL}/status`)).json();
        if (stopped) return;
        setStatus(data.record);
        setSigns((data.signs?.signs ?? []).map((s: string) => s.toLowerCase()));
      } catch {
        if (!stopped) setStatus(undefined);
      }
      if (!stopped) timer = setTimeout(poll, 400);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return { status, signs };
}
