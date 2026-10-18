// Speech to text for the doctor's side of a call, using the browser's speech
// recognition (Chrome and Edge). Where the browser can recognise speech on the
// device, it does, so no audio leaves the computer. Otherwise Chrome sends the
// audio to Google, and the page tells the doctor so.

// Not in TypeScript's DOM types yet; only what is used here.
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognitionClass {
  new (): Recognition;
  available?(opts: { langs: string[]; processLocally: boolean }): Promise<string>;
  install?(opts: { langs: string[]; processLocally: boolean }): Promise<boolean>;
}

const w = typeof window !== "undefined" ? (window as unknown as Record<string, RecognitionClass | undefined>) : {};
const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;

export const listenSupported = !!Recognition;

const LANG = "en-US";

// Can speech be recognised on this device? Tries to download the on-device
// model if the browser offers one. False means audio would go to the browser's
// cloud service.
export async function prepareOnDevice(): Promise<boolean> {
  if (!Recognition?.available) return false;
  try {
    const status = await Recognition.available({ langs: [LANG], processLocally: true });
    if (status === "available") return true;
    if ((status === "downloadable" || status === "downloading") && Recognition.install) {
      return await Recognition.install({ langs: [LANG], processLocally: true });
    }
  } catch {
    /* older browser: no on-device option */
  }
  return false;
}

export interface Listener {
  start(): void;
  stop(): void;
  // While the page is reading a patient sentence aloud, so it isn't captioned as the doctor.
  pause(): void;
  resume(): void;
}

export function createListener(opts: {
  onDevice: boolean;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (error: string) => void;
}): Listener | null {
  if (!Recognition) return null;
  let rec: Recognition | null = null;
  let wanted = false; // the doctor has captions on
  let paused = false;

  const begin = () => {
    rec = new Recognition();
    rec.lang = LANG;
    rec.continuous = true;
    rec.interimResults = true;
    if (opts.onDevice) rec.processLocally = true;
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const text = r[0].transcript.trim();
        if (r.isFinal) {
          if (text) opts.onFinal(text);
        } else {
          interim += `${text} `;
        }
      }
      opts.onInterim(interim.trim());
    };
    rec.onerror = (ev) => {
      // "no-speech" and "aborted" are routine; the session restarts below.
      if (ev.error !== "no-speech" && ev.error !== "aborted") opts.onError?.(ev.error);
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") wanted = false;
    };
    // Browsers end a session after a silence; keep listening while captions are on.
    rec.onend = () => {
      rec = null;
      if (wanted && !paused) setTimeout(() => wanted && !paused && !rec && begin(), 250);
    };
    try {
      rec.start();
    } catch {
      rec = null;
    }
  };

  const halt = () => {
    rec?.abort();
    rec = null;
    opts.onInterim("");
  };

  return {
    start() {
      wanted = true;
      paused = false;
      if (!rec) begin();
    },
    stop() {
      wanted = false;
      halt();
    },
    pause() {
      paused = true;
      halt();
    },
    resume() {
      paused = false;
      if (wanted && !rec) begin();
    },
  };
}
