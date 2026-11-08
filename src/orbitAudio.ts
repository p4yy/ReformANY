/**
 * Private, local Orbit interaction audio.
 * A tiny synthesized navigation tick; no sound assets, uploads or telemetry.
 */
export const ORBIT_AUDIO_KEY = "reformany.orbitSounds";

export function getOrbitSoundsEnabled(): boolean {
  try {
    // Sound is available out of the box; the user can switch it off any time.
    return localStorage.getItem(ORBIT_AUDIO_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setOrbitSoundsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ORBIT_AUDIO_KEY, enabled ? "on" : "off");
  } catch {
    // Do not fail the Appearance screen when local storage is disabled.
  }
}

let context: AudioContext | null = null;
let lastSoundAt = -Infinity;
const MIN_INTERVAL_MS = 105;

function contextForOrbit(): AudioContext | null {
  if (context) return context;
  try {
    if (typeof AudioContext !== "undefined") {
      context = new AudioContext({ latencyHint: "interactive" });
    }
  } catch {
    // Unsupported sound devices must not affect file conversion or navigation.
  }
  return context;
}

function shortTick(audio: AudioContext): void {
  if (!getOrbitSoundsEnabled() || audio.state !== "running") return;
  try {
    const started = audio.currentTime;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    // Subtle tactile 'tick', not a notification beep or a jingle.
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(820, started);
    oscillator.frequency.exponentialRampToValueAtTime(580, started + 0.05);
    gain.gain.setValueAtTime(0.0001, started);
    gain.gain.exponentialRampToValueAtTime(0.014, started + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, started + 0.055);

    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(started);
    oscillator.stop(started + 0.06);
  } catch {
    // Audio is an optional enhancement; never interrupt mouse navigation.
  }
}

/** Browser/WebView audio can require a pointer gesture to become unlocked. */
export function unlockOrbitAudio(): void {
  if (!getOrbitSoundsEnabled()) return;
  const audio = contextForOrbit();
  if (audio?.state === "suspended") {
    void audio.resume().catch(() => {});
  }
}

/** Runs on entering a different actionable control, never for pointer movement inside one. */
export function playOrbitHover(): void {
  if (!getOrbitSoundsEnabled()) return;
  const now = performance.now();
  if (now - lastSoundAt < MIN_INTERVAL_MS) return;
  lastSoundAt = now;
  const audio = contextForOrbit();
  if (!audio) return;
  if (audio.state === "running") {
    shortTick(audio);
  } else if (audio.state === "suspended") {
    // Some WebViews require the first click. Never play a stale hover afterward.
    void audio.resume().then(() => {
      if (performance.now() - now < 140) shortTick(audio);
    }).catch(() => {});
  }
}
