import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { RoomMessage } from "@synapse/shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One room per encounter. Clients connect to /ws?encounter=<uuid> and receive
// every utterance and pain reading stored for that encounter.
const rooms = new Map<string, Set<WebSocket>>();

export function attachRooms(server: Server, allowedOrigins: string[]) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const encounterId = url.searchParams.get("encounter") ?? "";
    const origin = req.headers.origin ?? "";
    if (url.pathname !== "/ws" || !UUID.test(encounterId) || !allowedOrigins.includes(origin)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let room = rooms.get(encounterId);
      if (!room) rooms.set(encounterId, (room = new Set()));
      room.add(ws);
      ws.on("close", () => {
        room.delete(ws);
        if (room.size === 0) rooms.delete(encounterId);
      });
    });
  });
}

export function broadcast(encounterId: string, msg: RoomMessage) {
  const payload = JSON.stringify(msg);
  for (const ws of rooms.get(encounterId) ?? []) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
