// Text to speech for the clinician screen, using the browser's own voices.
// Only on-device voices are used, so the sentence text stays on this computer
// (Edge's "Natural" and Chrome's "Google" voices are online and would send it
// to Microsoft or Google). Browsers block audio until the user has interacted
// with the page, so call unlockVoice() from a click first.

import type { VoiceTone } from "@signapse/shared";

export const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window;

let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  const english = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en") && v.localService);
  voice = english.find((v) => /aria|jenny|zira|samantha/i.test(v.name)) ?? english[0] ?? null;
}

if (speechSupported) {
  pickVoice();
  // Chrome loads voices asynchronously.
  speechSynthesis.addEventListener("voiceschanged", pickVoice);
}

export function unlockVoice() {
  if (!speechSupported) return;
  // A silent utterance inside a click handler unlocks audio for later calls.
  const u = new SpeechSynthesisUtterance("");
  u.volume = 0;
  speechSynthesis.speak(u);
}

// Speaks each part in its own tone (pitch, rate, volume), one after another.
export function speak(parts: { text: string; tone: VoiceTone }[]) {
  if (!speechSupported || !parts.length) return;
  // No on-device English voice: stay silent rather than send the text away.
  if (!voice) pickVoice();
  if (!voice) return;
  // Say the newest sentence now rather than queueing behind older ones.
  speechSynthesis.cancel();
  for (const { text, tone } of parts) {
    if (!text) continue;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.pitch = tone.pitch;
    u.rate = tone.rate;
    u.volume = tone.volume;
    speechSynthesis.speak(u);
  }
}
