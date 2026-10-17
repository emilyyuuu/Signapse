// Soft two-tone priority chime for urgent sentences, generated with Web Audio
// so there is no sound file to load. Browsers only allow audio after a click,
// so call unlockChime() from the "Enable voice" button first.

let ctx: AudioContext | null = null;

export function unlockChime() {
  ctx ??= new AudioContext();
  void ctx.resume();
}

export function chime(): number {
  if (!ctx) return 0;
  const now = ctx.currentTime;
  [880, 660].forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = now + i * 0.22;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(start);
    osc.stop(start + 0.4);
  });
  return 650; // ms until the chime has finished
}
