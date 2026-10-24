// A corpus of hand-drawn strokes for shape recognition, built from how a hand moves and how a digitizer samples it.
// Nothing here reads the recognizer or its tolerances. The numbers come from the hand. It places corners a little
// off, rounds or hooks them, and bows the sides. Its loops stop short of their start or run past it. Its pen slows
// into each corner (the two-thirds power law).

// A 60, 120, or 240 Hz digitizer samples the pen, with sensor noise and slow drift. Shapes come in all rotations and
// both directions, ended by a pen held still to ask for a shape or lifted at once. Beside them are letters, words,
// and scribbles drawn by the same hand, which must stay ink.

import { seededRandom } from '../fixtures';
import type { ShapeKind } from './types';
import { draw, type Ending, type TimedPoint } from './corpus/hand';
import { uniform, type Rand } from './corpus/intent';
import { SHAPES } from './corpus/shapes';
import { NOT_SHAPES } from './corpus/writing';

export type { Ending, TimedPoint } from './corpus/hand';

export interface Drawing {
  /** What was drawn, such as `rectangle` or `letter a`. */
  readonly name: string;
  /** The shape the hand meant, or null for writing and scribbles that must stay ink. */
  readonly expect: ShapeKind | null;
  /** A shape only the held pen asks for (more shapes): pentagons, stars, arcs, irregular polygons, and so on. */
  readonly extraOnly: boolean;
  readonly points: TimedPoint[];
}

const RATES = [60, 120, 240];
/** A steady hand, an ordinary one, and a hasty one: how far the hand strays, as a share of the ordinary. */
const CARE = [0.6, 1, 1.6];
const careOf = (k: number): number => CARE[Math.floor(k / RATES.length) % CARE.length];

/** Sizes in page units: a shape from small to large; writing from note size to a large heading. */
const shapeSize = (r: Rand): number => uniform(r, 40, 360);
const writingSize = (r: Rand): number => (r() < 0.7 ? uniform(r, 14, 45) : uniform(r, 45, 140));

/** `count` drawings of every shape, for one way of ending the stroke. Seeded, so a failure replays. */
export function shapeCorpus(count: number, ending: Ending, seed = 1): Drawing[] {
  return SHAPES.flatMap((spec, s) =>
    Array.from({ length: count }, (_, k) => {
      const r = seededRandom(seed * 1_000_003 + s * 7919 + k * 104_729);
      const size = shapeSize(r);
      const points = draw(r, spec.make(r, size), size, RATES[k % RATES.length], ending, true, careOf(k));
      return { name: spec.name, expect: spec.expect, extraOnly: spec.extraOnly === true, points };
    }),
  );
}

/** `count` drawings of every letter, word, and scribble, for one way of ending the stroke. */
export function inkCorpus(count: number, ending: Ending, seed = 1): Drawing[] {
  return NOT_SHAPES.filter((spec) => ending === 'lift' || spec.liftOnly !== true).flatMap((spec, s) =>
    Array.from({ length: count }, (_, k) => {
      const r = seededRandom(seed * 2_000_003 + s * 7919 + k * 104_729);
      const size = spec.name.startsWith('letter') || spec.name.startsWith('word') ? writingSize(r) : shapeSize(r);
      const points = draw(r, spec.make(r, size), size, RATES[k % RATES.length], ending, false, careOf(k));
      return { name: spec.name, expect: null, extraOnly: false, points };
    }),
  );
}
