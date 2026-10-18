import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "../brand";
import type { CallState } from "../../lib/useCall";

// A <video> showing a MediaStream (React can't set srcObject as a prop).
export function StreamVideo({ stream, muted, className, label }: { stream?: MediaStream; muted?: boolean; className?: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== (stream ?? null)) ref.current.srcObject = stream ?? null;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} aria-label={label} />;
}

// The call picture: the other person large, yourself small in the corner, and
// captions over the bottom of the video.
export function CallStage({
  remote,
  self,
  remoteMuted,
  remoteLabel,
  placeholder,
  children,
}: {
  remote?: MediaStream;
  self?: MediaStream;
  remoteMuted?: boolean;
  remoteLabel: string;
  placeholder: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="call-stage">
      {remote ? (
        <StreamVideo className="call-remote" stream={remote} muted={remoteMuted} label={remoteLabel} />
      ) : (
        <div className="call-placeholder">{placeholder}</div>
      )}
      {self && <StreamVideo className="call-self" stream={self} muted label="Your camera" />}
      {children && <div className="call-captions">{children}</div>}
    </div>
  );
}

const STATE_TEXT: Record<CallState, string> = {
  waiting: "Waiting",
  knocking: "Waiting to join",
  connecting: "Connecting…",
  connected: "Connected",
  ended: "Call ended",
};

// Call status plus the safety code. Matching codes on both screens mean the
// call is encrypted end to end with nobody in the middle.
export function CallStatus({ state, safetyCode }: { state: CallState; safetyCode?: string }) {
  return (
    <div className="call-status">
      <span className={`status ${state === "connected" ? "live" : state === "connecting" ? "connecting" : ""}`}>
        <i aria-hidden="true" />
        {STATE_TEXT[state]}
      </span>
      {safetyCode && (
        <span
          className="chip ok safety"
          title="End-to-end encrypted. Check that the other screen shows the same code; if it does, nobody else can see or hear this call."
        >
          <Icon name="lock" size={12} /> Encrypted · code <b>{safetyCode}</b>
        </span>
      )}
    </div>
  );
}
