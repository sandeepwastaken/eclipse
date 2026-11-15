import { create } from 'zustand';
import lines from '../data/voice-lines.json';

/**
 * Mission-control callouts. Each line is a clip voiced with ElevenLabs (scripts/make_voice.mjs),
 * played through a radio band-pass and framed by the Apollo-era Quindar tones (2525 Hz in,
 * 2475 Hz out). Where a clip is missing, the browser's own speech voice stands in.
 */
export type LineId = (typeof lines)[number]['id'];
const TEXT = new Map(lines.map((l) => [l.id, l.text]));

export const useVoice = create<{ on: boolean; toggle: () => void }>((set, get) => ({
  on: false,
  toggle: () => {
    const on = !get().on;
    set({ on });
    if (on) void say('voice-on', true);
  },
}));

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let busyUntil = 0;
let lastId = '';

function audio() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function clip(id: string) {
  let p = buffers.get(id);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}audio/${id}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? audio().decodeAudioData(b) : null))
      .catch(() => null);
    buffers.set(id, p);
  }
  return p;
}

function quindar(at: number, hz: number) {
  const c = audio();
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = hz;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.06, at + 0.01);
  g.gain.setValueAtTime(0.06, at + 0.24);
  g.gain.linearRampToValueAtTime(0, at + 0.25);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + 0.26);
}

/** Speak a line (skipped if another is still playing, unless forced). */
export async function say(id: LineId, force = false) {
  if (!useVoice.getState().on && !force) return;
  const now = performance.now();
  if (!force && (now < busyUntil || (id === lastId && now < busyUntil + 1500))) return;
  lastId = id;
  const c = audio();
  const buf = await clip(id);
  const t0 = c.currentTime + 0.02;
  quindar(t0, 2525);
  if (buf) {
    const src = c.createBufferSource();
    src.buffer = buf;
    // Radio voice: narrow band, a little drive.
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 320;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const g = c.createGain();
    g.gain.value = 0.9;
    src.connect(hp).connect(lp).connect(g).connect(c.destination);
    src.start(t0 + 0.3);
    quindar(t0 + 0.35 + buf.duration, 2475);
    busyUntil = now + (0.7 + buf.duration) * 1000;
  } else if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(TEXT.get(id) ?? id);
    u.rate = 1.05;
    u.pitch = 0.95;
    window.setTimeout(() => window.speechSynthesis.speak(u), 300);
    u.onend = () => quindar(audio().currentTime + 0.02, 2475);
    busyUntil = now + 2600;
  }
}
