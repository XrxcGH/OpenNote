// A benchmark corpus for shape recognition: many hand-wobbled strokes of each shape, and many strokes that are not
// shapes (handwriting, zigzags, scribbles). It measures how often each shape is named correctly and how often a
// non-shape is wrongly snapped, so a change to recognition shows as numbers. The floors below only ever rise.

import { describe, expect, it } from 'vitest';
import { seededRandom } from '../fixtures';
import { densify } from '../simplify';
import type { Vec } from '../types';
import { recognizeShape } from './recognize';
import type { ShapeKind } from './types';

type Kind = ShapeKind | 'freeform';

const DEG = Math.PI / 180;
/** Wobble as a share of the stroke's size: a steady hand, an ordinary one, and a shaky one. */
const NOISE_LEVELS = [0.004, 0.009, 0.015];
const SEEDS_PER_LEVEL = 12;

const rot = (p: Vec, degrees: number): Vec => {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

function regular(n: number, radius: number, turn = -90): Vec[] {
  return Array.from({ length: n }, (_, i) => ({
    x: radius * Math.cos((turn + (360 * i) / n) * DEG),
    y: radius * Math.sin((turn + (360 * i) / n) * DEG),
  }));
}

function star(tips: number, outer: number, inner: number): Vec[] {
  return Array.from({ length: tips * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = (-90 + (180 * i) / tips) * DEG;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
}

const stretch = (pts: Vec[], sx: number, sy: number) => pts.map((p) => ({ x: p.x * sx, y: p.y * sy }));
const arc = (r: number, from: number, to: number, n = 40): Vec[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (from + ((to - from) * i) / n) * DEG;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
const shift = (pts: Vec[], dx: number, dy: number) => pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
const v = (x: number, y: number): Vec => ({ x, y });

interface Spec {
  readonly name: string;
  readonly expect: Kind;
  /** The ideal path, centered near the origin. */
  readonly path: Vec[];
  readonly closed: boolean;
}

const closedSpec = (name: string, expectKind: Kind, corners: Vec[]): Spec => ({
  name,
  expect: expectKind,
  path: corners,
  closed: true,
});

/** Shapes the recognizer named before freeform polygons existed; the rest are the irregular ones. */
const IRREGULAR = [
  'rhombus',
  'trapezoid',
  'parallelogram',
  'house',
  'arrow block',
  'L shape',
  'irregular pentagon',
  'kite',
];

const POSITIVES: Spec[] = [
  { name: 'line', expect: 'line', closed: false, path: [v(-110, 6), v(110, -4)] },
  { name: 'diagonal line', expect: 'line', closed: false, path: [v(-90, -70), v(95, 80)] },
  {
    name: 'arrow',
    expect: 'arrow',
    closed: false,
    path: [v(-100, 0), v(100, 0), v(70, -26), v(100, 0), v(70, 26)],
  },
  closedSpec('rectangle', 'rectangle', [v(-110, -60), v(110, -60), v(110, 60), v(-110, 60)]),
  closedSpec('square', 'rectangle', regular(4, 90, -45)),
  closedSpec(
    'tilted rectangle',
    'rectangle',
    stretch(regular(4, 100, -45), 1.5, 0.8).map((p) => rot(p, 18)),
  ),
  closedSpec('diamond', 'rectangle', regular(4, 95, -90)),
  closedSpec('rhombus', 'freeform', [v(0, -90), v(50, 0), v(0, 90), v(-50, 0)]),
  closedSpec('triangle', 'triangle', [v(0, -85), v(100, 70), v(-100, 70)]),
  closedSpec('right triangle', 'triangle', [v(-80, -70), v(-80, 70), v(90, 70)]),
  closedSpec('skewed triangle', 'triangle', [v(-90, 60), v(60, -75), v(110, 60)]),
  { name: 'circle', expect: 'circle', closed: true, path: arc(90, 0, 360, 72) },
  { name: 'ellipse', expect: 'ellipse', closed: true, path: stretch(arc(60, 0, 360, 72), 1.9, 1) },
  { name: 'arc', expect: 'arc', closed: false, path: arc(90, 200, 330, 30) },
  closedSpec('pentagon', 'polygon', regular(5, 90)),
  closedSpec('hexagon', 'polygon', regular(6, 90, 0)),
  closedSpec('star', 'star', star(5, 95, 38)),
  closedSpec('trapezoid', 'freeform', [v(-60, -60), v(60, -60), v(115, 60), v(-115, 60)]),
  closedSpec('parallelogram', 'freeform', [v(-60, -60), v(120, -60), v(60, 60), v(-120, 60)]),
  closedSpec('house', 'freeform', [v(0, -100), v(90, -30), v(90, 80), v(-90, 80), v(-90, -30)]),
  closedSpec('arrow block', 'freeform', [
    v(-110, -30),
    v(20, -30),
    v(20, -70),
    v(110, 0),
    v(20, 70),
    v(20, 30),
    v(-110, 30),
  ]),
  closedSpec('L shape', 'freeform', [v(-80, -90), v(-20, -90), v(-20, 30), v(80, 30), v(80, 90), v(-80, 90)]),
  closedSpec('irregular pentagon', 'freeform', [v(-100, -20), v(-30, -90), v(80, -60), v(110, 50), v(-50, 80)]),
  closedSpec('kite', 'freeform', [v(0, -110), v(60, -20), v(0, 90), v(-60, -20)]),
];

const wave = (cycles: number, amp: number, len: number): Vec[] =>
  Array.from({ length: 80 }, (_, i) => v((len * i) / 79 - len / 2, amp * Math.sin((cycles * 2 * Math.PI * i) / 79)));

const NEGATIVES: { name: string; path: Vec[] }[] = [
  { name: 'wave', path: wave(2.5, 30, 220) },
  { name: 'long wave', path: wave(4, 22, 260) },
  { name: 'zigzag', path: [v(-100, 40), v(-50, -40), v(0, 40), v(50, -40), v(100, 40)] },
  { name: 'letter M', path: [v(-70, 70), v(-70, -70), v(0, 10), v(70, -70), v(70, 70)] },
  { name: 'letter W', path: [v(-80, -70), v(-40, 70), v(0, -20), v(40, 70), v(80, -70)] },
  { name: 'letter N', path: [v(-60, 70), v(-60, -70), v(60, 70), v(60, -70)] },
  { name: 'letter Z', path: [v(-60, -70), v(60, -70), v(-60, 70), v(60, 70)] },
  { name: 'letter S', path: [...shift(arc(40, -30, -270, 24), 0, -40), ...shift(arc(40, 90, 330, 24), 0, 40)] },
  {
    name: 'spiral',
    path: Array.from({ length: 90 }, (_, i) => v((10 + i) * 0.9 * Math.cos(i / 9), (10 + i) * 0.9 * Math.sin(i / 9))),
  },
  { name: 'letter e', path: [v(-50, 0), v(50, 0), ...arc(50, 0, -300, 40)] },
  { name: 'checkmark', path: [v(-60, 0), v(-20, 50), v(70, -70)] },
  {
    name: 'figure eight',
    path: Array.from({ length: 80 }, (_, i) =>
      v(90 * Math.sin((2 * Math.PI * i) / 79), 55 * Math.sin((4 * Math.PI * i) / 79)),
    ),
  },
  { name: 'letter 3', path: [...shift(arc(40, -150, 90, 24), 0, -40), ...shift(arc(45, -90, 150, 24), 0, 45)] },
  { name: 'letter U', path: [v(-60, -70), v(-60, 30), ...shift(arc(60, 180, 0, 20), 0, 30), v(60, -70)] },
  { name: 'letter V', path: [v(-70, -70), v(0, 70), v(70, -70)] },
  { name: 'letter T', path: [v(-70, -70), v(70, -70), v(70, -64), v(4, -64), v(4, 70)] },
  {
    name: 'tight scribble',
    path: Array.from({ length: 120 }, (_, i) => v(40 * Math.sin(i * 1.7) + i * 0.8 - 50, 40 * Math.cos(i * 2.3))),
  },
  {
    name: 'cursive loops',
    path: Array.from({ length: 100 }, (_, i) => v(i * 2.2 - 110 + 22 * Math.cos(i / 2.2), 22 * Math.sin(i / 2.2))),
  },
  { name: 'bracket', path: [v(30, -80), v(-30, -80), v(-30, 80), v(30, 80)] },
  { name: 'lightning bolt', path: [v(30, -90), v(-40, 10), v(20, 10), v(-30, 90)] },
  { name: 'letter K', path: [v(-40, -80), v(-40, 80), v(-40, 0), v(40, -80), v(-40, 0), v(40, 80)] },
  { name: 'letter P', path: [v(-40, 80), v(-40, -80), v(30, -80), v(50, -40), v(30, 0), v(-40, 0)] },
];

/** One hand-drawn pass over a path: smooth drift and jitter, and for closed shapes a start gap or an overshoot. */
function drawn(spec: { path: Vec[]; closed?: boolean }, seed: number, noise: number): Vec[] {
  const random = seededRandom(seed * 7919 + 13);
  let ideal = spec.path;
  if (spec.closed) {
    const first = ideal[0];
    const second = ideal[1];
    const last = ideal[ideal.length - 1];
    const slip = random() * 0.2 - 0.05;
    if (slip >= 0)
      ideal = [...ideal, first, v(first.x + (second.x - first.x) * slip, first.y + (second.y - first.y) * slip)];
    else ideal = [...ideal, v(last.x + (first.x - last.x) * (1 + slip), last.y + (first.y - last.y) * (1 + slip))];
  }
  const dense = densify(ideal, 3.2);
  const xs = dense.map((p) => p.x);
  const ys = dense.map((p) => p.y);
  const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const amp = noise * size;
  const phase = [random() * 6.28, random() * 6.28];
  const freq = 2 + random() * 3;
  return dense.map((p, i) => {
    const t = i / dense.length;
    return {
      x: 300 + p.x + amp * 1.6 * Math.sin(freq * 6.28 * t + phase[0]) + (random() - 0.5) * amp * 0.9,
      y: 300 + p.y + amp * 1.6 * Math.sin(freq * 6.28 * t + phase[1]) + (random() - 0.5) * amp * 0.9,
    };
  });
}

interface Row {
  readonly name: string;
  readonly correct: number;
  readonly wrong: number;
  readonly total: number;
  /** What the wrong answers were, such as `freeform x3`. */
  readonly confused?: string;
}

const round = (k: Kind) => k === 'circle' || k === 'ellipse';

function runPositives(): Row[] {
  return POSITIVES.map((spec) => {
    let correct = 0;
    let wrong = 0;
    let total = 0;
    const confusions = new Map<string, number>();
    NOISE_LEVELS.forEach((noise, level) => {
      for (let s = 0; s < SEEDS_PER_LEVEL; s++) {
        total++;
        const match = recognizeShape(drawn(spec, level * 100 + s + 1, noise), { extra: true });
        if (!match) continue;
        // A drawn circle may come back as an ellipse and the reverse: both are round, so both count.
        const kind: Kind = match.shape.kind;
        if (kind === spec.expect || (round(kind) && round(spec.expect))) correct++;
        else {
          wrong++;
          confusions.set(kind, (confusions.get(kind) ?? 0) + 1);
        }
      }
    });
    const confused = [...confusions].map(([k, n]) => `${k} x${n}`).join(', ');
    return { name: spec.name, correct, wrong, total, confused };
  });
}

function runNegatives(): Row[] {
  return NEGATIVES.map((spec) => {
    let wrong = 0;
    let total = 0;
    NOISE_LEVELS.forEach((noise, level) => {
      for (let s = 0; s < SEEDS_PER_LEVEL; s++) {
        total++;
        // Handwriting is drawn at the same wobble, and checked with the extra shapes on, which is the harder case.
        if (recognizeShape(drawn(spec, level * 100 + s + 1, noise), { extra: true })) wrong++;
      }
    });
    return { name: spec.name, correct: total - wrong, wrong, total };
  });
}

/**
 * The same corpus run before freeform polygons and the lookalike margins existed (commit before 2b60bde5): right answers
 * per class out of 36. Kept so the gain stays reproducible from the repository, not only from a log.
 */
const BEFORE: Record<string, number> = {
  line: 36,
  'diagonal line': 30,
  arrow: 29,
  rectangle: 36,
  square: 36,
  'tilted rectangle': 33,
  diamond: 32,
  rhombus: 0,
  triangle: 34,
  'right triangle': 35,
  'skewed triangle': 36,
  circle: 29,
  ellipse: 36,
  arc: 24,
  pentagon: 36,
  hexagon: 36,
  star: 32,
  trapezoid: 0,
  parallelogram: 0,
  house: 0,
  'arrow block': 0,
  'L shape': 0,
  'irregular pentagon': 0,
  kite: 0,
};
/** Wrong-shape answers before (a circle named a hexagon, a pentagon named a rectangle): 19 of 864. */
const BEFORE_WRONG = 19;

const sum = (rows: Row[], key: 'correct' | 'wrong' | 'total') => rows.reduce((s, r) => s + r[key], 0);

describe('shape recognition benchmark', () => {
  const positives = runPositives();
  const negatives = runNegatives();
  const core = positives.filter((r) => !IRREGULAR.includes(r.name));
  const irregular = positives.filter((r) => IRREGULAR.includes(r.name));
  const coreRecall = sum(core, 'correct') / sum(core, 'total');
  const irregularRecall = sum(irregular, 'correct') / sum(irregular, 'total');
  const falsePositive = sum(negatives, 'wrong') / sum(negatives, 'total');

  it('reports the recognition numbers', () => {
    const lines = [
      ...positives.map(
        (r) =>
          `  ${r.name.padEnd(20)} before ${String(BEFORE[r.name]).padStart(2)} -> ${r.correct}/${r.total} right, ${r.wrong} wrong shape ${r.confused ?? ''}`,
      ),
      ...negatives
        .filter((r) => r.wrong > 0)
        .map((r) => `  NOT A SHAPE: ${r.name.padEnd(14)} ${r.wrong}/${r.total} snapped`),
      `  core recall ${(coreRecall * 100).toFixed(1)}%  irregular recall ${(irregularRecall * 100).toFixed(1)}%  ` +
        `false positives ${(falsePositive * 100).toFixed(1)}%`,
    ];
    console.info(`shape benchmark\n${lines.join('\n')}`);
    expect(positives.length).toBeGreaterThan(0);
  });

  it('names the shapes it was built for', () => {
    expect(coreRecall).toBeGreaterThanOrEqual(0.9);
  });

  it('names irregular polygons such as trapezoids, houses, and L shapes', () => {
    // Before freeform polygons existed this was 0%.
    expect(irregularRecall).toBeGreaterThanOrEqual(0.88);
  });

  it('beats the recorded baseline overall, with fewer wrong shapes and no class losing more than one drawing', () => {
    const before = Object.values(BEFORE).reduce((a, b) => a + b, 0);
    expect(sum(positives, 'correct')).toBeGreaterThan(before + 200);
    expect(sum(positives, 'wrong')).toBeLessThanOrEqual(BEFORE_WRONG);
    positives.forEach((r) => expect(r.correct, r.name).toBeGreaterThanOrEqual(BEFORE[r.name] - 1));
  });

  it('leaves handwriting and scribbles alone', () => {
    expect(falsePositive).toBeLessThanOrEqual(0.02);
  });
});
