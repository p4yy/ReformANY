/**
 * Orbit sounds. Every cue is routed through one master GainNode, so the
 * Preferences volume slider changes the actual output level.
 */
export type Cue = "tick" | "switch" | "open" | "close" | "confirm";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let level = 0.65;

/** Perceptual curve: 0–100% slider → gain. */
const gainFor = (v: number) => Math.pow(Math.min(1, Math.max(0, v)), 1.7) * 0.55;

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = gainFor(level);
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setOrbitAudio(on: boolean, volumePct: number) {
  enabled = on;
  level = volumePct / 100;
  if (ctx && master) master.gain.setTargetAtTime(gainFor(level), ctx.currentTime, 0.012);
}

const CUES: Record<Cue, Array<{ f0: number; f1: number; at: number; dur: number; type: OscillatorType; amp: number }>> = {
  tick: [{ f0: 1850, f1: 1500, at: 0, dur: 0.035, type: "triangle", amp: 0.5 }],
  switch: [{ f0: 980, f1: 1320, at: 0, dur: 0.07, type: "sine", amp: 0.7 }],
  open: [
    { f0: 520, f1: 780, at: 0, dur: 0.09, type: "sine", amp: 0.7 },
    { f0: 1040, f1: 1180, at: 0.05, dur: 0.09, type: "triangle", amp: 0.4 },
  ],
  close: [{ f0: 880, f1: 440, at: 0, dur: 0.11, type: "sine", amp: 0.6 }],
  confirm: [
    { f0: 880, f1: 880, at: 0, dur: 0.06, type: "sine", amp: 0.7 },
    { f0: 1320, f1: 1320, at: 0.07, dur: 0.1, type: "sine", amp: 0.7 },
  ],
};

export function play(cue: Cue, force = false) {
  if (!enabled && !force) return;
  const ac = ensure();
  if (!ac || !master) return;
  const t0 = ac.currentTime + 0.005;
  for (const n of CUES[cue]) {
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type = n.type;
    osc.frequency.setValueAtTime(n.f0, t0 + n.at);
    osc.frequency.exponentialRampToValueAtTime(n.f1, t0 + n.at + n.dur);
    env.gain.setValueAtTime(0.0001, t0 + n.at);
    env.gain.exponentialRampToValueAtTime(n.amp, t0 + n.at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
    osc.connect(env).connect(master);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.dur + 0.02);
  }
}
