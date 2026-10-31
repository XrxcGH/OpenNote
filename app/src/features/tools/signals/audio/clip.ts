// The sound the audio tabs share: a mono clip at 16 kHz held in memory for this visit (never saved or sent). It
// comes from a file the student picks, a microphone recording (the browser asks first), or the tone generator.
// The platform decodes and resamples it (Web Audio).
import { useSyncExternalStore } from 'react';
import { generateTone } from './engine';

export const CLIP_RATE = 16000;
/**
 * Longer clips are cut to this many seconds (about 38 MB of samples), so memory stays bounded. A long clip's
 * analysis runs in the signals worker with progress and Cancel.
 */
export const MAX_SECONDS = 600;

export interface Clip {
  samples: Float32Array;
  rate: number;
  /** A short name: the file's, or a word for a recording or a generated tone. */
  name: string;
}

/** The example: a synthetic /a/-like vowel, a 120 Hz pulse train through resonances at 700, 1200, and 2600 Hz. */
function exampleClip(): Clip {
  const n = CLIP_RATE;
  let x = Float64Array.from({ length: n }, (_, i) => (i % Math.round(CLIP_RATE / 120) === 0 ? 1 : 0));
  for (const [f, bw] of [
    [700, 80],
    [1200, 90],
    [2600, 120],
  ] as const) {
    const r = Math.exp((-Math.PI * bw) / CLIP_RATE);
    const a1 = 2 * r * Math.cos((2 * Math.PI * f) / CLIP_RATE);
    const a2 = -r * r;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i += 1) y[i] = x[i]! + a1 * (y[i - 1] ?? 0) + a2 * (y[i - 2] ?? 0);
    x = y;
  }
  let peak = 0;
  x.forEach((v) => (peak = Math.max(peak, Math.abs(v))));
  return { samples: Float32Array.from(x, (v) => (0.8 * v) / peak), rate: CLIP_RATE, name: 'example' };
}

let current: Clip = exampleClip();
const listeners = new Set<() => void>();

export function setClip(clip: Clip): void {
  const limit = MAX_SECONDS * clip.rate;
  current = clip.samples.length > limit ? { ...clip, samples: clip.samples.slice(0, limit) } : clip;
  listeners.forEach((listen) => listen());
}

/** Puts the example back, as on a fresh start (for tests). */
export function resetClip(): void {
  setClip(exampleClip());
}

export const useClip = (): Clip =>
  useSyncExternalStore(
    (listen) => {
      listeners.add(listen);
      return () => listeners.delete(listen);
    },
    () => current,
  );

/** Decodes audio bytes and resamples them to one 16 kHz channel. */
export async function decodeClip(bytes: ArrayBuffer, name: string): Promise<Clip> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes);
    const length = Math.max(1, Math.ceil(decoded.duration * CLIP_RATE));
    const offline = new OfflineAudioContext(1, length, CLIP_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return { samples: rendered.getChannelData(0).slice(), rate: CLIP_RATE, name };
  } finally {
    void context.close();
  }
}

/** Records from the microphone until `stop` is called; the browser asks for permission first. */
export async function startRecording(): Promise<{ stop(): Promise<Clip> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  recorder.start();
  return {
    stop: () =>
      new Promise<Clip>((resolve, reject) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          void new Blob(chunks, { type: recorder.mimeType })
            .arrayBuffer()
            .then((bytes) => decodeClip(bytes, 'recording'))
            .then(resolve, reject);
        };
        recorder.stop();
      }),
  };
}

/** Plays samples through the speakers. */
export function play(samples: ArrayLike<number>, rate: number): void {
  const context = new AudioContext();
  const buffer = context.createBuffer(1, samples.length, rate);
  buffer.getChannelData(0).set(Float32Array.from(samples));
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.onended = () => void context.close();
  source.start();
}

export const toneClip = (spec: Parameters<typeof generateTone>[0]): Clip => ({
  samples: Float32Array.from(generateTone(spec, CLIP_RATE)),
  rate: CLIP_RATE,
  name: 'tone',
});
