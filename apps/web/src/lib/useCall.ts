import { useCallback, useEffect, useRef, useState } from "react";
import type { CallRole, CallSignal, RoomMessage } from "@signapse/shared";
import { useRoom } from "./useRoom";

// A video call between the patient and a doctor. Audio, video and live captions
// go straight between the two browsers, encrypted end to end by WebRTC
// (DTLS-SRTP); the Signapse server only relays the setup messages. The patient
// lets the doctor in, and both screens show a safety code: if the codes match,
// nobody sits in the middle of the call.

export type CallState = "waiting" | "knocking" | "connecting" | "connected" | "ended";

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turn = import.meta.env.VITE_TURN_URL;
  if (turn) {
    servers.push({
      urls: turn,
      username: import.meta.env.VITE_TURN_USER,
      credential: import.meta.env.VITE_TURN_PASS,
    });
  }
  return servers;
}

// Six digits from both sides' DTLS certificate fingerprints. The signalling
// server could only intercept the call by swapping a fingerprint, which changes
// the code on one screen but not the other.
async function safetyCodeOf(pc: RTCPeerConnection) {
  const fingerprints = [pc.localDescription?.sdp, pc.remoteDescription?.sdp].map(
    (sdp) => sdp?.match(/^a=fingerprint:(\S+ \S+)/m)?.[1]?.toUpperCase() ?? "",
  );
  if (fingerprints.some((f) => !f)) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprints.sort().join("|")));
  const n = new DataView(digest).getUint32(0) % 1_000_000;
  const s = String(n).padStart(6, "0");
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

interface Options {
  encounterId: string;
  role: CallRole;
  // What this side sends. Tracks can change mid-call without renegotiating.
  video?: MediaStreamTrack;
  audio?: MediaStreamTrack;
  // Every other room message (utterances, the visit ending, ...).
  onMessage: (msg: RoomMessage) => void;
  // Live caption text from the doctor, over the encrypted data channel.
  onCaption?: (text: string) => void;
}

export function useCall({ encounterId, role, video, audio, onMessage, onCaption }: Options) {
  const [state, setState] = useState<CallState>(role === "doctor" ? "knocking" : "waiting");
  const [remoteStream, setRemoteStream] = useState<MediaStream>();
  const [safetyCode, setSafetyCode] = useState<string>();
  const pcRef = useRef<RTCPeerConnection>();
  const channel = useRef<RTCDataChannel>();
  const admitted = useRef(false);
  const doctorWaiting = useRef(false);
  const ended = useRef(false);
  const queue = useRef(Promise.resolve()); // handle signals one at a time, in order
  const tracks = useRef({ video, audio });
  tracks.current = { video, audio };
  const captionHandler = useRef(onCaption);
  captionHandler.current = onCaption;
  const messageHandler = useRef(onMessage);
  messageHandler.current = onMessage;

  const sendRef = useRef<(s: Omit<CallSignal, "from">) => void>(() => {});

  const setupChannel = (ch: RTCDataChannel) => {
    channel.current = ch;
    ch.onmessage = (ev) => {
      try {
        const { text } = JSON.parse(ev.data) as { text: string };
        if (typeof text === "string") captionHandler.current?.(text.slice(0, 500));
      } catch {
        /* ignore anything that isn't a caption */
      }
    };
  };

  const closePeer = () => {
    pcRef.current?.close();
    pcRef.current = undefined;
    channel.current = undefined;
    setRemoteStream(undefined);
    setSafetyCode(undefined);
  };

  // Puts this side's current tracks on the call.
  const applyTracks = (pc: RTCPeerConnection) => {
    for (const t of pc.getTransceivers()) {
      const kind = t.receiver.track.kind as "audio" | "video";
      const track = tracks.current[kind] ?? null;
      if (t.sender.track !== track) void t.sender.replaceTrack(track).catch(() => {});
      t.direction = "sendrecv";
    }
  };

  const newPeer = () => {
    closePeer();
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    pcRef.current = pc;
    const remote = new MediaStream();
    pc.ontrack = (ev) => {
      remote.addTrack(ev.track);
      setRemoteStream(new MediaStream(remote.getTracks()));
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendRef.current({ kind: "ice", candidate: ev.candidate.toJSON() as CallSignal["candidate"] });
    };
    pc.ondatachannel = (ev) => setupChannel(ev.channel);
    pc.onconnectionstatechange = () => {
      if (pc !== pcRef.current) return;
      if (pc.connectionState === "connected") {
        setState("connected");
        void safetyCodeOf(pc).then(setSafetyCode);
      }
      if (pc.connectionState === "failed") {
        // Try again from the patient's side; the doctor waits for a new offer.
        setState("connecting");
        if (role === "patient" && admitted.current) void offer();
      }
    };
    return pc;
  };

  // The patient always starts the call.
  const offer = async () => {
    setState("connecting");
    const pc = newPeer();
    pc.addTransceiver("audio", { direction: "sendrecv" });
    pc.addTransceiver("video", { direction: "sendrecv" });
    applyTracks(pc);
    setupChannel(pc.createDataChannel("captions"));
    await pc.setLocalDescription(await pc.createOffer());
    sendRef.current({ kind: "offer", sdp: pc.localDescription!.sdp });
  };

  const handleSignal = async (s: CallSignal) => {
    if (s.from === role || ended.current) return;
    switch (s.kind) {
      case "hello":
        // The other side's room connection blipped and reconnected; the call itself is fine.
        // (A reload or a new tab sends bye first, so the call is no longer connected.)
        if (pcRef.current?.connectionState === "connected") return;
        if (role === "doctor") {
          // The patient (re)joined: say we're here so they can let us in.
          closePeer();
          setState("knocking");
          sendRef.current({ kind: "hello" });
        } else {
          // A doctor is at the door. A new arrival always needs the patient's OK.
          closePeer();
          admitted.current = false;
          doctorWaiting.current = true;
          setState("knocking");
        }
        break;
      case "admit":
        if (role === "doctor") setState("connecting");
        break;
      case "offer": {
        if (role !== "doctor" || !s.sdp) return;
        const pc = newPeer();
        await pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
        applyTracks(pc);
        await pc.setLocalDescription(await pc.createAnswer());
        sendRef.current({ kind: "answer", sdp: pc.localDescription!.sdp });
        break;
      }
      case "answer":
        if (role === "patient" && s.sdp && pcRef.current) {
          await pcRef.current.setRemoteDescription({ type: "answer", sdp: s.sdp });
        }
        break;
      case "ice":
        if (s.candidate && pcRef.current?.remoteDescription) {
          await pcRef.current.addIceCandidate(s.candidate).catch(() => {});
        }
        break;
      case "bye":
        closePeer();
        admitted.current = false;
        doctorWaiting.current = false;
        setState(role === "doctor" ? "ended" : "waiting");
        break;
    }
  };

  const { connected, send } = useRoom(
    encounterId,
    (msg) => {
      if (msg.type === "signal") {
        queue.current = queue.current.then(() => handleSignal(msg.data)).catch((err) => console.warn(err));
        return;
      }
      messageHandler.current(msg);
    },
    { call: role, onOpen: () => sendRef.current({ kind: "hello" }) },
  );
  sendRef.current = (s) => send({ type: "signal", data: { ...s, from: role } });

  // New camera or microphone: swap it into the running call.
  useEffect(() => {
    if (pcRef.current?.remoteDescription) applyTracks(pcRef.current);
  }, [video, audio]);

  // Tell the other side when this tab closes.
  useEffect(() => {
    const bye = () => sendRef.current({ kind: "bye" });
    addEventListener("pagehide", bye);
    return () => {
      removeEventListener("pagehide", bye);
      pcRef.current?.close();
    };
  }, []);

  const admit = useCallback(() => {
    if (role !== "patient" || !doctorWaiting.current) return;
    admitted.current = true;
    doctorWaiting.current = false;
    sendRef.current({ kind: "admit" });
    queue.current = queue.current.then(offer).catch((err) => console.warn(err));
  }, [role]);

  const hangUp = useCallback(() => {
    sendRef.current({ kind: "bye" });
    ended.current = true;
    closePeer();
    setState("ended");
  }, []);

  const sendCaption = useCallback((text: string) => {
    const ch = channel.current;
    if (ch?.readyState === "open") ch.send(JSON.stringify({ text: text.slice(0, 500) }));
  }, []);

  return { state, remoteStream, safetyCode, connected, admit, hangUp, sendCaption };
}
