// A made-up person's calibration page for tests and test builds: every box written in the neutral hand at a known
// size and slant, and the sentences written with known spacing. Nothing here is anyone's real handwriting.
import { CALIBRATION_CHARS, SAMPLES_PER_CHAR, SENTENCES, charSampleId, sentenceSampleId } from './charset';
import { buildStyle } from './metrics';
import { neutralGlyph } from './neutral';
import { flatten, pointsOf } from './style';
import type { FlatStroke, HandStyle, Progress, RawSample } from './style';
import { seeded, writeText } from './write';

export interface SyntheticHand {
  /** The x-height in box pixels. */
  readonly xHeight: number;
  /** Degrees; positive leans right. */
  readonly slant: number;
  readonly seed: number;
}

export const BOX = { width: 96, height: 112, baseline: 76, guide: 22 } as const;

const shear = (slant: number) => Math.tan((slant * Math.PI) / 180);

/** One box's writing for a character, as the made-up person would write it the `n`th time. */
export function syntheticSample(char: string, n: number, hand: SyntheticHand): RawSample {
  const glyph = neutralGlyph(char) ?? neutralGlyph('?')!;
  const rand = seeded(hand.seed * 977 + n * 31 + (char.codePointAt(0) ?? 0));
  const size = hand.xHeight * (1 + (rand() - 0.5) * 0.06);
  const k = shear(hand.slant);
  const strokes: FlatStroke[] = glyph.strokes.map((stroke) =>
    flatten(
      pointsOf(stroke).map((p) => ({
        x: 20 + p.x * size - p.y * size * k,
        y: BOX.baseline + p.y * size,
        p: 0.45 + rand() * 0.2,
        t: p.t * (1 + n * 0.05),
      })),
    ),
  );
  return {
    strokes,
    baseline: BOX.baseline,
    guide: BOX.guide,
    width: BOX.width,
    height: BOX.height,
    at: 1_700_000_000_000 + n,
  };
}

/** A sentence written in the neutral hand with known spacing. */
export function syntheticSentence(n: number, hand: SyntheticHand): RawSample {
  const text = SENTENCES[n];
  const written = writeText(
    text,
    null,
    { left: 10, width: 100_000, baseline: 60, xHeight: hand.xHeight, next: (y) => y + 100 },
    hand.seed + n,
  );
  const k = shear(hand.slant);
  const strokes = written.paths.map((path) =>
    flatten(path.map((p) => ({ x: p.x - (p.y - 60) * k, y: p.y, p: p.pressure, t: p.time }))),
  );
  return { strokes, baseline: 60, guide: BOX.guide, width: 4000, height: 120, at: 1_700_000_000_000 };
}

/** The whole calibration page, or all of it but `leave` boxes from the end. */
export function syntheticProgress(hand: SyntheticHand = { xHeight: 20, slant: 8, seed: 3 }, leave = 0): Progress {
  const samples: Record<string, RawSample> = {};
  for (const char of CALIBRATION_CHARS) {
    for (let n = 0; n < SAMPLES_PER_CHAR; n++) samples[charSampleId(char, n)] = syntheticSample(char, n, hand);
  }
  SENTENCES.forEach((_, n) => (samples[sentenceSampleId(n)] = syntheticSentence(n, hand)));
  const ids = Object.keys(samples);
  for (const id of ids.slice(ids.length - leave)) delete samples[id];
  return { samples, step: 0 };
}

/** A finished style from the made-up page. */
export function syntheticStyle(hand?: SyntheticHand): HandStyle {
  return buildStyle(syntheticProgress(hand), null, 1_700_000_000_000)!;
}
