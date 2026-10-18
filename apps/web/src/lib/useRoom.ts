import { useEffect, useRef, useState } from "react";
import type { RoomMessage } from "@signapse/shared";
import { API_URL } from "./api";

// Joins an encounter's live room and calls onMessage for every utterance and
// pain reading. Reconnects automatically if the connection drops.
export function useRoom(encounterId: string, onMessage: (msg: RoomMessage) => void, role: "patient" | "clinician" = "clinician") {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws?encounter=${encounterId}&role=${role}`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (ev) => handler.current(JSON.parse(ev.data) as RoomMessage);
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws.close();
    };
  }, [encounterId, role]);

  return { connected };
}
