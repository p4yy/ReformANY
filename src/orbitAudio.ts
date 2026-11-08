/**
 * Private, local Orbit interaction audio.
 * A tiny synthesized navigation tick; no sound assets, uploads or telemetry.
 */
export const ORBIT_AUDIO_KEY = "reformany.orbitSounds";
export const ORBIT_VOLUME_KEY = "reformany.orbitVolume";
export const DEFAULT_ORBIT_VOLUME = 65;

export function getOrbitVolume(): number {
  try {
    const value = localStorage.getItem(ORBIT_VOLUME_KEY);
    if (value === null) return DEFAULT_ORBIT_VOLUME;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : DEFAULT_ORBIT_VOLUME;
  } catch {
    return DEFAULT_ORBIT_VOLUME;
  }
}

export function setOrbitVolume(volume: number): void {
  try {
    localStorage.setItem(ORBIT_VOLUME_KEY, String(Math.max(0, Math.min(100, Math.round(volume)))));
  } catch {
    // Audio settings are optional; never interrupt the app when storage is denied.
  }
}

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
  if (!getOrbitSoundsEnabled() || getOrbitVolume() === 0 || audio.state !== "running") return;
  try {
    const started = audio.currentTime;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    // Subtle tactile 'tick', not a notification beep or a jingle.
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(820, started);
    oscillator.frequency.exponentialRampToValueAtTime(580, started + 0.05);
    gain.gain.setValueAtTime(0.0001, started);
    // The old 0.014 fixed peak was barely audible on many Windows devices.
    // Keep a bounded gain even at 100%; zero is genuinely silent.
    const volume = getOrbitVolume() / 100;
    if (volume === 0) return;
    const peak = 0.09 * Math.pow(volume, 1.25);
    gain.gain.exponentialRampToValueAtTime(peak, started + 0.004);
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

/** Test the saved sound and volume from a user-clicked Preferences button. */
export function previewOrbitSound(): void {
  if (!getOrbitSoundsEnabled() || getOrbitVolume() === 0) return;
  const audio = contextForOrbit();
  if (!audio) return;
  if (audio.state === "running") {
    shortTick(audio);
  } else if (audio.state === "suspended") {
    void audio.resume().then(() => shortTick(audio)).catch(() => {});
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
