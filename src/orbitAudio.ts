import { invoke, isTauri } from "@tauri-apps/api/core";
/**
 * ReformANY Orbit sound preferences.
 * Native opening/closing cues are produced by Windows so the closing cue
 * finishes before the process exits. Short hover feedback uses WebAudio on
 * the pointer thread for immediate response, not a Tauri IPC round trip.
 */
export const ORBIT_AUDIO_KEY = "reformany.orbitSounds";
export const ORBIT_VOLUME_KEY = "reformany.orbitVolume";
export const DEFAULT_ORBIT_VOLUME = 55;
export type OrbitSoundEvent = "open" | "close" | "hover";

const kindKeys: Record<OrbitSoundEvent, string> = {
  open: "reformany.orbitAudio.open",
  close: "reformany.orbitAudio.close",
  hover: "reformany.orbitAudio.hover",
};

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
  } catch { /* Sound is always optional. */ }
}
export function getOrbitSoundsEnabled(): boolean {
  try { return localStorage.getItem(ORBIT_AUDIO_KEY) !== "off"; }
  catch { return true; }
}
export function setOrbitSoundsEnabled(enabled: boolean): void {
  try { localStorage.setItem(ORBIT_AUDIO_KEY, enabled ? "on" : "off"); }
  catch { /* Storage denial must not block Orbit. */ }
}
export function getOrbitSoundKindEnabled(kind: OrbitSoundEvent): boolean {
  try { return localStorage.getItem(kindKeys[kind]) !== "off"; }
  catch { return true; }
}
export function setOrbitSoundKindEnabled(kind: OrbitSoundEvent, enabled: boolean): void {
  try { localStorage.setItem(kindKeys[kind], enabled ? "on" : "off"); }
  catch { /* Optional preference. */ }
}
let context: AudioContext | null = null;
let lastHoverAt = -Infinity;
let hoverSuppressedUntil = 0;
const HOVER_INTERVAL_MS = 90;
/** Avoid hover chatter while the longer opening bloom is still audible. */
export function suppressOrbitHover(milliseconds=420): void {
  hoverSuppressedUntil = Math.max(hoverSuppressedUntil, performance.now()+milliseconds);
}

function getContext(): AudioContext | null {
  if (context) return context;
  try {
    if (typeof AudioContext !== "undefined")
      context = new AudioContext({ latencyHint: "interactive" });
  } catch { /* An unsupported audio device must never block file operations. */ }
  return context;
}

/** Subtle, filtered silk-touch texture, not a bright synthesizer tick. */
function playHaptic(audio: AudioContext): void {
  if (audio.state !== "running" || !getOrbitSoundsEnabled() ||
      !getOrbitSoundKindEnabled("hover") || getOrbitVolume() === 0) return;
  try {
    const sampleRate = audio.sampleRate;
    const length = Math.max(128, Math.round(sampleRate * 0.05));
    const buffer = audio.createBuffer(1, length, sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = 0x50e7a421;
    let filtered = 0;
    let softened = 0;
    const level = getOrbitVolume() / 100;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const noise = ((seed >>> 0) % 65536) / 32767.5 - 1;
      filtered += (noise - filtered) * 0.18;
      softened += (filtered - softened) * 0.28;
      const attack = Math.min(1, t / 0.045);
      const envelope = attack * Math.pow(1 - t, 2.7);
      const warmth = Math.sin(2 * Math.PI * 245 * i / sampleRate);
      channel[i] = (0.92 * softened + 0.08 * warmth) * envelope * 0.095 * level;
    }
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    gain.gain.value = 0.78;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(audio.destination);
    source.addEventListener("ended", () => { source.disconnect(); gain.disconnect(); }, { once: true });
    source.start();
  } catch { /* Pointer response always takes priority. */ }
}

/** Unlock only when a user gesture occurs; avoid stale delayed hover sounds. */
export function unlockOrbitAudio(): void {
  if (!getOrbitSoundsEnabled()) return;
  const audio = getContext();
  if (audio?.state === "suspended") void audio.resume().catch(() => {});
}
export function playOrbitHover(): void {
  if (!getOrbitSoundsEnabled() || !getOrbitSoundKindEnabled("hover")) return;
  const now = performance.now();
  if (now < hoverSuppressedUntil || now - lastHoverAt < HOVER_INTERVAL_MS) return;
  lastHoverAt = now;
  // A Windows WebView can begin with AudioContext suspended. Native playback
  // guarantees the *first hover* is heard without requiring an extra click.
  // Fast IPC and the 90ms gate preserve responsive navigation.
  if (isTauri()) {
    void invoke("orbit_play_sound",{kind:"hover"}).catch(() => {});
    return;
  }
  const audio = getContext();
  if (audio?.state === "running") playHaptic(audio);
}
/** Browser fallback for Preferences (installed Windows app uses native previews). */
export function previewOrbitSound(kind: OrbitSoundEvent = "hover"): void {
  if (!getOrbitSoundsEnabled() || !getOrbitSoundKindEnabled(kind)) return;
  const audio = getContext();
  if (!audio) return;
  if (audio.state === "running") playHaptic(audio);
  else if (audio.state === "suspended") {
    void audio.resume().then(() => playHaptic(audio)).catch(() => {});
  }
}
