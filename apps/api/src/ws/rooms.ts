import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { RoomMessage } from "@signapse/shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Role = "patient" | "clinician";
interface Client {
  ws: WebSocket;
  role: Role;
}

// One room per encounter. Clients connect to /ws?encounter=<uuid>&role=patient|clinician
// and receive every utterance and pain reading for that encounter. Messages meant
// only for the patient (a signed clause they have not sent yet) go to role=patient
// screens and never to the clinician. The role is declared by the screen; there is
// no sign-in yet, so this separates the screens but is not security.
const rooms = new Map<string, Set<Client>>();

// What a patient screen should see when it connects (a draft already waiting).
let patientHello: (encounterId: string) => RoomMessage | undefined = () => undefined;
export function setPatientHello(fn: (encounterId: string) => RoomMessage | undefined) {
  patientHello = fn;
}

export function attachRooms(server: Server, allowedOrigins: string[]) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const encounterId = url.searchParams.get("encounter") ?? "";
    const role: Role = url.searchParams.get("role") === "patient" ? "patient" : "clinician";
    const origin = req.headers.origin ?? "";
    if (url.pathname !== "/ws" || !UUID.test(encounterId) || !allowedOrigins.includes(origin)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let room = rooms.get(encounterId);
      if (!room) rooms.set(encounterId, (room = new Set()));
      const client: Client = { ws, role };
      room.add(client);
      ws.on("close", () => {
        room.delete(client);
        if (room.size === 0) rooms.delete(encounterId);
      });
      if (role === "patient") {
        const hello = patientHello(encounterId);
        if (hello) ws.send(JSON.stringify(hello));
      }
    });
  });
}

export function broadcast(encounterId: string, msg: RoomMessage, audience: "all" | "patient" = "all") {
  const payload = JSON.stringify(msg);
  for (const c of rooms.get(encounterId) ?? []) {
    if (audience === "patient" && c.role !== "patient") continue;
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(payload);
  }
}
