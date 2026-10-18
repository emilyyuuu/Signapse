import type { ReactNode } from "react";
import type { Encounter } from "@signapse/shared";
import { Logo } from "./brand";

type Screen = "visits" | "patient" | "clinician" | "review" | "call" | "wizard" | "record";

interface Props {
  screen: Screen;
  encounter?: Encounter;
  // Live-connection state; omit on screens without a live room.
  connected?: boolean;
  // Page buttons shown at the right of the header (e.g. New visit).
  actions?: ReactNode;
  children: ReactNode;
}

const SCREEN_LABEL: Record<Screen, string> = {
  visits: "Visits",
  patient: "Patient",
  clinician: "Clinician",
  review: "Review",
  call: "Call",
  wizard: "Wizard",
  record: "Record signs",
};

// Shared header for every screen: brand, visit token, live status and
// navigation. The patient screen is a kiosk, so it gets no navigation and
// can't wander into the clinician's screens. Call screens are used by the
// patient and an outside doctor, so they get none either.
export function AppShell({ screen, encounter, connected, actions, children }: Props) {
  const kiosk = screen === "patient" || screen === "call";
  const status = encounter?.endedAt
    ? { cls: "is-ended", text: "Visit ended" }
    : connected === undefined
      ? null
      : connected
        ? { cls: "live", text: "Live" }
        : { cls: "connecting", text: "Connecting…" };

  const links: { screen: Screen; href: string }[] = [
    { screen: "visits", href: "/" },
    ...(encounter
      ? (["patient", "clinician", "review"] as const).map((s) => ({
          screen: s,
          href: `/${s}?e=${encounter.encounterId}`,
        }))
      : []),
  ];

  return (
    <>
      <header className="shell">
        <div className="shell-in">
          <a className="brand" href={kiosk ? undefined : "/"}>
            <Logo />
            Signapse
          </a>
          {encounter && (
            <span className="token" title="Patient name and visit token">
              {kiosk ? encounter.patientRef : (encounter.patientName ?? encounter.patientRef)}
            </span>
          )}
          {status && (
            <span className={`status ${status.cls}`} role="status">
              <i aria-hidden="true" />
              {status.text}
            </span>
          )}
          {!kiosk && (
            <nav className="shell-nav" aria-label="Screens">
              {links.map((l) => (
                <a key={l.screen} href={l.href} aria-current={l.screen === screen ? "page" : undefined}>
                  {SCREEN_LABEL[l.screen]}
                </a>
              ))}
            </nav>
          )}
          {actions && <div className="shell-actions">{actions}</div>}
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
