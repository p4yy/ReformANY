import type { Preferences } from '../types';
export type OrbitCue = 'open' | 'close' | 'hover' | 'switch';
let context: AudioContext | null = null;
let lastHover = -1000;
let lastOpen = -1000;
/** Original, short locally-synthesized UI sound cues; no external samples. */
export function playOrbitCue(settings: Preferences, cue: OrbitCue) {
  if (!settings.orbitSounds || settings.orbitVolume <= 0) return;
  if (cue === 'open' && !settings.orbitOpeningSound) return;
  if (cue === 'close' && !settings.orbitClosingSound) return;
  if (cue === 'hover' && !settings.orbitHoverSound) return;
  const stamp = performance.now();
  if (cue === 'hover' && stamp - lastHover < 65) return;
  if (cue === 'open' && stamp - lastOpen < 400) return;
  if (cue === 'hover') lastHover = stamp;
  if (cue === 'open') lastOpen = stamp;
  const Ctor = window.AudioContext || (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  if (!Ctor) return;
  try {
    if (!context || context.state === 'closed') context = new Ctor({latencyHint:'interactive'});
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    const now = context.currentTime + .002;
    const volume = Math.min(.05, settings.orbitVolume / 100 * .042);
    const notes: Array<[number, number, number, number, OscillatorType]> = cue === 'open'
      ? [[350, 525, 0, .14, 'triangle'], [660, 740, .047, .11, 'sine']]
      : cue === 'close' ? [[510, 280, 0, .12, 'triangle'], [370, 300, .02, .09, 'sine']]
      : cue === 'hover' ? [[540, 480, 0, .039, 'triangle']]
      : [[585, 445, 0, .068, 'triangle'], [790, 715, .012, .046, 'sine']];
    for (const [from, to, delay, duration, type] of notes) {
      const start = now + delay;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const lowPass = context.createBiquadFilter();
      lowPass.type = 'lowpass'; lowPass.frequency.value = cue === 'hover' ? 1900 : 2500;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(from, start);
      oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume * (type === 'sine' ? .31 : 1)), start + Math.min(.009, duration * .18));
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(lowPass); lowPass.connect(gain); gain.connect(context.destination);
      oscillator.start(start); oscillator.stop(start + duration + .002);
      oscillator.onended = () => {oscillator.disconnect(); lowPass.disconnect(); gain.disconnect();};
    }
  } catch { /* UI sounds are never allowed to block native actions. */ }
}
