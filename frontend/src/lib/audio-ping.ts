/**
 * In-app "new order" ping for the rider PWA (Group D2) — used when the app
 * is in the FOREGROUND (background/closed is handled by the service
 * worker's own notification sound, see public/rider-sw.js). Chrome
 * suppresses/mutes a push notification's own sound while its origin tab is
 * focused, so foreground riders need a separate, deliberate audible alert
 * or they'd miss new orders while looking right at the screen.
 *
 * Synthesized via the Web Audio API rather than shipping an audio file —
 * no binary asset, no network fetch/latency, no licensing question. Two
 * short ascending tones, loud enough to notice over background noise
 * without being a full siren.
 */
let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
}

function beep(ctx: AudioContext, startAt: number, freq: number, durationSec: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  // Quick attack, short hold, quick decay — avoids a harsh click at start/end.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.35, startAt + 0.02);
  gain.gain.setValueAtTime(0.35, startAt + durationSec - 0.05);
  gain.gain.linearRampToValueAtTime(0, startAt + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec);
}

/** Plays the two-tone "new order" ping and, where supported, a matching
 *  vibration pulse. Browsers require a prior user gesture on the page
 *  before audio will actually play (autoplay policy) — a rider will have
 *  already tapped something (online toggle, accept button, etc.) well
 *  before the first poll fires in practice, but this fails silently
 *  either way, never throws into the caller's poll loop. */
export function playNewOrderPing(): void {
  try {
    const ctx = getContext();
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      beep(ctx, now, 740, 0.14);
      beep(ctx, now + 0.16, 988, 0.18);
    }
  } catch {
    // Autoplay-blocked or no AudioContext — foreground ping is a nicety,
    // not a requirement (the visual feed update + toast still happen).
  }
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([120, 60, 120]);
    }
  } catch {
    /* vibration API can throw on some engines outside a user gesture — ignore */
  }
}
