import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import type { CallRole, ClientRoomMessage, RoomMessage } from "@signapse/shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Call setup only (SDP and ICE). Audio, video and captions go peer to peer,
// encrypted between the two browsers, so they never reach this server.
const signalSchema = z
  .object({
    type: z.literal("signal"),
    data: z
      .object({
        from: z.enum(["patient", "doctor"]),
        kind: z.enum(["hello", "admit", "offer", "answer", "ice", "bye"]),
        sdp: z.string().max(20_000).optional(),
        candidate: z
          .object({
            candidate: z.string().max(1000),
            sdpMid: z.string().max(64).nullable().optional(),
            sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
            usernameFragment: z.string().max(256).nullable().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

const MAX_PER_SECOND = 50;

type Role = "patient" | "clinician";
interface Client {
  ws: WebSocket;
  role: Role;
  call?: CallRole; // set on the patient's and doctor's call screens
}

// One room per encounter. Clients connect to /ws?encounter=<uuid>&role=patient|clinician
// and receive every utterance and pain reading for that encounter. Messages meant
// only for the patient (a signed clause they have not sent yet) go to role=patient
// screens and never to the clinician. The role is declared by the screen; there is
// no sign-in yet, so this separates the screens but is not security.
// Call screens add &call=patient|doctor; each call role can be open once per room,
// so a third person with the link can't join the call.
const rooms = new Map<string, Set<Client>>();

// What a patient screen should see when it connects (a draft already waiting).
let patientHello: (encounterId: string) => RoomMessage | undefined = () => undefined;
export function setPatientHello(fn: (encounterId: string) => RoomMessage | undefined) {
  patientHello = fn;
}

export function attachRooms(server: Server, allowedOrigins: string[]) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const encounterId = url.searchParams.get("encounter") ?? "";
    const callParam = url.searchParams.get("call");
    const call = callParam === "patient" || callParam === "doctor" ? callParam : undefined;
    // The doctor's call screen is a clinician screen, whatever it declares.
    const role: Role = url.searchParams.get("role") === "patient" && call !== "doctor" ? "patient" : "clinician";
    const origin = req.headers.origin ?? "";
    if (url.pathname !== "/ws" || !UUID.test(encounterId) || !allowedOrigins.includes(origin)) {
      socket.destroy();
      return;
    }
    if (callParam !== null && !call) {
      socket.destroy();
      return;
    }
    const taken = call && [...(rooms.get(encounterId) ?? [])].some((c) => c.call === call);
    if (taken) {
      socket.write("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let room = rooms.get(encounterId);
      if (!room) rooms.set(encounterId, (room = new Set()));
      const client: Client = { ws, role, call };
      room.add(client);

      let windowStart = Date.now();
      let count = 0;
      ws.on("message", (raw, isBinary) => {
        // Only call screens may send, and only call setup messages.
        if (!client.call || isBinary) return;
        const now = Date.now();
        if (now - windowStart > 1000) {
          windowStart = now;
          count = 0;
        }
        if (++count > MAX_PER_SECOND) return;
        let json: unknown;
        try {
          json = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const parsed = signalSchema.safeParse(json);
        if (!parsed.success || parsed.data.data.from !== client.call) return;
        relay(encounterId, client, parsed.data as ClientRoomMessage);
      });
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

// Sends a call message to the other call screen in the room only.
function relay(encounterId: string, sender: Client, msg: ClientRoomMessage) {
  const payload = JSON.stringify(msg satisfies RoomMessage);
  for (const c of rooms.get(encounterId) ?? []) {
    if (c !== sender && c.call && c.ws.readyState === c.ws.OPEN) c.ws.send(payload);
  }
}

export function broadcast(encounterId: string, msg: RoomMessage, audience: "all" | "patient" = "all") {
  const payload = JSON.stringify(msg);
  for (const c of rooms.get(encounterId) ?? []) {
    if (audience === "patient" && c.role !== "patient") continue;
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(payload);
  }
}
