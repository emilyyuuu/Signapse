// Text to speech for the clinician screen, using the browser's built-in voices.
// Nothing is sent off the device. Browsers block audio until the user has
// interacted with the page, so call unlockVoice() from a click first.

export const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window;

let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  // Prefer a natural-sounding English voice when the browser has one.
  voice =
    voices.find((v) => v.lang.startsWith("en") && /natural|google|aria|jenny/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null;
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

// onEnd runs when the sentence has been said (or failed), e.g. to resume listening.
export function speak(text: string, opts: { urgent?: boolean; onEnd?: () => void } = {}) {
  if (!speechSupported || !text) {
    opts.onEnd?.();
    return;
  }
  // Say the newest sentence now rather than queueing behind older ones.
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(opts.urgent ? `Urgent. ${text}` : text);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? "en-US";
  u.rate = 0.95;
  if (opts.onEnd) {
    let done = false;
    const end = () => {
      if (!done) (done = true), opts.onEnd!();
    };
    u.onend = end;
    u.onerror = end;
  }
  speechSynthesis.speak(u);
}
