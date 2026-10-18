import { useCallback, useEffect, useRef, useState } from "react";
import type { CallRole, ClientRoomMessage, RoomMessage } from "@signapse/shared";
import { API_URL } from "./api";

// Joins an encounter's live room and calls onMessage for every utterance and
// pain reading. Reconnects automatically if the connection drops. Patient
// screens pass role "patient" to also get their unsent drafts. Call screens
// pass their call role so they can send call setup messages with send().
export function useRoom(
  encounterId: string,
  onMessage: (msg: RoomMessage) => void,
  opts: { role?: "patient" | "clinician"; call?: CallRole; onOpen?: () => void } = {},
) {
  const role = opts.role ?? (opts.call === "patient" ? "patient" : "clinician");
  const [connected, setConnected] = useState(false);
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const onOpen = useRef(opts.onOpen);
  onOpen.current = opts.onOpen;
  const socket = useRef<WebSocket>();

  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      const call = opts.call ? `&call=${opts.call}` : "";
      ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws?encounter=${encounterId}&role=${role}${call}`);
      socket.current = ws;
      ws.onopen = () => {
        setConnected(true);
        onOpen.current?.();
      };
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
  }, [encounterId, role, opts.call]);

  const send = useCallback((msg: ClientRoomMessage) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { connected, send };
}
