// Synthetic handwriting and gestures for tests. The pen corpus of real recordings does not exist yet (see
// tests/fixtures/pen), so these generators stand in. They draw cursive words, loops, and letters the way a hand moves,
// with small wobble, so a detector that must never fire on handwriting is tested on many different strokes.

import { seededRandom } from '../../geometry/fixtures';
import type { InkPoint, Vec } from '../../geometry/types';

const SAMPLE_MS = 8;

function sampled(path: Vec[], random: () => number, wobble: number): InkPoint[] {
  return path.map((p, i) => ({
    x: p.x + (random() - 0.5) * wobble,
    y: p.y + (random() - 0.5) * wobble,
    pressure: 0.3 + random() * 0.5,
    time: i * SAMPLE_MS,
  }));
}

/** A cursive word: steady progress to the right with rising and falling strokes and small loops. */
export function cursiveWord(seed: number, letters = 6, size = 14): InkPoint[] {
  const random = seededRandom(seed);
  const path: Vec[] = [];
  let x = 0;
  const y = 0;
  for (let l = 0; l < letters; l++) {
    const kind = Math.floor(random() * 4);
    for (let k = 0; k <= 12; k++) {
      const a = (k / 12) * 2 * Math.PI;
      const loop = kind === 0 ? size * 0.35 : 0;
      const rise = kind === 1 ? -Math.abs(Math.sin(a / 2)) * size * 1.4 : Math.sin(a) * size * 0.4;
      path.push({ x: x + (k / 12) * size * 0.9 - Math.sin(a) * loop, y: y + rise + (loop ? Math.cos(a) * loop : 0) });
    }
    x += size * 0.9;
  }
  return sampled(path, random, 0.4);
}

/** A run of the letters m, n, u, or w drawn in one stroke, which go up and down but still move to the right. */
export function humps(seed: number, count = 4, size = 12): InkPoint[] {
  const random = seededRandom(seed);
  const path: Vec[] = [];
  const up = random() < 0.5;
  for (let h = 0; h <= count * 10; h++) {
    const t = h / 10;
    path.push({ x: t * size * 0.7, y: (up ? -1 : 1) * Math.abs(Math.sin(t * Math.PI)) * size });
  }
  return sampled(path, random, 0.3);
}

/** A closed loop like the letter o, or a larger circle around content. */
export function circle(seed: number, radius = 40, center: Vec = { x: 0, y: 0 }, turns = 1.05): InkPoint[] {
  const random = seededRandom(seed);
  const path = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 59) * turns * 2 * Math.PI;
    return { x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius };
  });
  return sampled(path, random, 0.5);
}

/** A scribble: `passes` sweeps back and forth across a box, each pass taking `passMs`. */
export function scribble(seed: number, passes = 7, width = 160, height = 40, passMs = 220): InkPoint[] {
  const random = seededRandom(seed);
  const perPass = Math.max(4, Math.round(passMs / SAMPLE_MS));
  const path: Vec[] = [];
  for (let p = 0; p < passes; p++) {
    for (let k = 0; k < perPass; k++) {
      const t = k / perPass;
      const x = p % 2 === 0 ? t * width : (1 - t) * width;
      path.push({ x, y: (p / passes) * height + random() * height * 0.15 });
    }
  }
  return sampled(path, random, 1);
}

/** A page's worth of handwriting-like strokes for a detector that must stay quiet. */
export function handwritingCorpus(count: number, seed = 1): InkPoint[][] {
  const strokes: InkPoint[][] = [];
  for (let i = 0; i < count; i++) {
    const kind = i % 4;
    if (kind === 0) strokes.push(cursiveWord(seed * 1000 + i, 3 + (i % 8)));
    else if (kind === 1) strokes.push(humps(seed * 1000 + i, 2 + (i % 5)));
    else if (kind === 2) strokes.push(circle(seed * 1000 + i, 6 + (i % 5) * 2));
    else strokes.push(cursiveWord(seed * 1000 + i, 8 + (i % 12), 10));
  }
  return strokes;
}
