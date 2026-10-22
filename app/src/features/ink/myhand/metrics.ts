// From the calibration page's boxes and sentences to a style: each box becomes a letter in x-height units, and the
// boxes and sentences together give the person's sizes, slant, spacing, joins, pressure, speed, and how much their
// baseline wanders. Everything is measured with medians, so one odd sample doesn't move a measure much.
import {
  ASCENDER_LETTERS,
  CALIBRATION_CHARS,
  CAP_LETTERS,
  DESCENDER_LETTERS,
  SAMPLES_PER_CHAR,
  SENTENCES,
  X_HEIGHT_LETTERS,
  parseSampleId,
  requiredSamples,
} from './charset';
import { DEFAULT_HABITS, DEFAULT_METRICS, LIMITS, clamp01, flatten, pointsOf } from './style';
import type { FlatStroke, GlyphSample, HandMetrics, HandPoint, HandStyle, Progress, RawSample, Spread } from './style';

export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function spread(values: readonly number[], fallback: Spread): Spread {
  if (values.length === 0) return fallback;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length === 1) return { mean, sd: fallback.sd };
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

export function boxOfStrokes(strokes: readonly FlatStroke[]): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stroke of strokes) {
    for (let i = 0; i + 3 < stroke.length; i += 4) {
      x0 = Math.min(x0, stroke[i]);
      x1 = Math.max(x1, stroke[i]);
      y0 = Math.min(y0, stroke[i + 1]);
      y1 = Math.max(y1, stroke[i + 1]);
    }
  }
  return x0 <= x1 ? { x0, y0, x1, y1 } : null;
}

/**
 * The slant of the strokes' upright parts, in degrees (positive leans right), or null when they have none. It is
 * the most common angle, weighted by length, so the stems of letters count and the diagonals of a v or an x don't.
 */
export function slantOf(strokes: readonly FlatStroke[]): number | null {
  const bins = new Float64Array(71);
  const samples: { angle: number; length: number }[] = [];
  for (const stroke of strokes) {
    const points = pointsOf(stroke);
    for (let i = 1; i < points.length; i++) {
      let dx = points[i].x - points[i - 1].x;
      let dy = points[i].y - points[i - 1].y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-6 || Math.abs(dx) > Math.abs(dy) * 0.7) continue;
      if (dy > 0) [dx, dy] = [-dx, -dy];
      const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
      samples.push({ angle, length });
      bins[Math.max(0, Math.min(70, Math.round(angle) + 35))] += length;
    }
  }
  if (samples.length === 0) return null;
  let peak = 0;
  let best = -1;
  for (let b = 0; b < bins.length; b++) {
    let sum = 0;
    for (let k = -3; k <= 3; k++) sum += bins[b + k] ?? 0;
    if (sum > best) [best, peak] = [sum, b - 35];
  }
  let sum = 0;
  let weight = 0;
  for (const { angle, length } of samples) {
    if (Math.abs(angle - peak) > 5) continue;
    sum += angle * length;
    weight += length;
  }
  return weight > 0 ? sum / weight : peak;
}

/** A box's writing as a letter: x from the left of the ink, y from the baseline, in x-heights. */
export function normalizeSample(
  sample: RawSample,
  xHeight: number,
  source: GlyphSample['source'] = 'pen',
): GlyphSample | null {
  const box = boxOfStrokes(sample.strokes);
  if (!box || !(xHeight > 0)) return null;
  const t0 = Math.min(...sample.strokes.map((s) => s[3] ?? 0));
  const strokes = sample.strokes.map((stroke) =>
    flatten(
      pointsOf(stroke).map((p) => ({
        x: (p.x - box.x0) / xHeight,
        y: (p.y - sample.baseline) / xHeight,
        p: p.p,
        t: p.t - t0,
      })),
    ),
  );
  return { strokes, width: (box.x1 - box.x0) / xHeight, source };
}

function sampleOf(progress: Progress, id: string): RawSample | undefined {
  return progress.samples[id];
}

/** Whether every box and sentence of the calibration page has writing in it. */
export function isComplete(progress: Progress): boolean {
  return requiredSamples().every((id) => (sampleOf(progress, id)?.strokes.length ?? 0) > 0);
}

/** How much of the calibration page is done, 0 to 1. */
export function completion(progress: Progress): number {
  const ids = requiredSamples();
  return ids.filter((id) => (sampleOf(progress, id)?.strokes.length ?? 0) > 0).length / ids.length;
}

interface CharSample {
  readonly char: string;
  readonly kind: 'char' | 'math';
  readonly n: number;
  readonly sample: RawSample;
  readonly box: Box;
}

function charSamples(progress: Progress): CharSample[] {
  const out: CharSample[] = [];
  for (const [id, sample] of Object.entries(progress.samples)) {
    const parsed = parseSampleId(id);
    const box = boxOfStrokes(sample.strokes);
    if (parsed && parsed.kind !== 'sentence' && box)
      out.push({ char: parsed.char, kind: parsed.kind, n: parsed.n, sample, box });
  }
  return out;
}

const heightAbove = (s: CharSample) => s.sample.baseline - s.box.y0;
const pick = (all: CharSample[], chars: readonly string[]) => all.filter((s) => chars.includes(s.char));

/** One stroke's length and how long it took. */
function strokeMotion(stroke: FlatStroke): { length: number; ms: number } {
  const points = pointsOf(stroke);
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  const ms = points.length > 1 ? points[points.length - 1].t - points[0].t : 0;
  return { length, ms };
}

/** What a sentence shows: the gaps between words and letters, joins, and each word's baseline. */
export interface SentenceMeasure {
  readonly wordGaps: number[];
  readonly letterGaps: number[];
  readonly pairs: { pair: string; joined: boolean }[];
  readonly baselines: number[];
}

interface Blob {
  x0: number;
  x1: number;
  strokes: FlatStroke[];
}

/** Strokes side by side that overlap across, merged: the pieces of a line with clear space between them. */
export function blobsOf(strokes: readonly FlatStroke[], tolerance: number): Blob[] {
  const items = strokes
    .map((stroke) => ({ stroke, box: boxOfStrokes([stroke]) }))
    .filter((item): item is { stroke: FlatStroke; box: Box } => item.box !== null)
    .sort((a, b) => a.box.x0 - b.box.x0);
  const blobs: Blob[] = [];
  for (const { stroke, box } of items) {
    const last = blobs[blobs.length - 1];
    if (last && box.x0 <= last.x1 + tolerance) {
      last.x1 = Math.max(last.x1, box.x1);
      last.strokes.push(stroke);
    } else blobs.push({ x0: box.x0, x1: box.x1, strokes: [stroke] });
  }
  return blobs;
}

const isLetter = (char: string) => /^\p{L}$/u.test(char);

/** Measures one written sentence against its text and the widths of the person's letters. */
export function measureSentence(
  sample: RawSample,
  text: string,
  widthOf: (char: string) => number,
  xHeight: number,
): SentenceMeasure | null {
  const words = text.split(/\s+/).filter(Boolean);
  const blobs = blobsOf(sample.strokes, xHeight * 0.04);
  if (words.length === 0 || blobs.length < words.length) return null;
  // The widest gaps are between words: as many as the sentence has.
  const gaps = blobs.slice(1).map((blob, i) => ({ i: i + 1, gap: blob.x0 - blobs[i].x1 }));
  const cuts = [...gaps]
    .sort((a, b) => b.gap - a.gap)
    .slice(0, words.length - 1)
    .map((g) => g.i)
    .sort((a, b) => a - b);
  const groups: Blob[][] = [];
  let from = 0;
  for (const cut of [...cuts, blobs.length]) {
    groups.push(blobs.slice(from, cut));
    from = cut;
  }
  const wordGaps = cuts.map((cut) => (blobs[cut].x0 - blobs[cut - 1].x1) / xHeight);
  const letterGaps: number[] = [];
  const pairs: { pair: string; joined: boolean }[] = [];
  const baselines: number[] = [];
  groups.forEach((group, w) => {
    const letters = [...words[w]];
    const strokes = group.flatMap((blob) => blob.strokes);
    const x0 = group[0].x0;
    const width = (group[group.length - 1].x1 - x0) / xHeight;
    const widths = letters.map(widthOf);
    const inkWidth = widths.reduce((a, b) => a + b, 0);
    if (letters.length > 1) {
      const gap = (width - inkWidth) / (letters.length - 1);
      if (gap > -0.4 && gap < 1.5) letterGaps.push(gap);
      // Where each letter would sit if the word were spread evenly, and which strokes cross from one into the next.
      const scale = width / Math.max(1e-6, inkWidth + Math.max(0, gap) * (letters.length - 1));
      let at = 0;
      for (let i = 0; i < letters.length - 1; i++) {
        const end = at + widths[i] * scale;
        const next = end + Math.max(0, gap) * scale;
        const boundary = x0 + ((end + next) / 2) * xHeight;
        const before = boundary - widths[i] * scale * 0.3 * xHeight;
        const after = boundary + widths[i + 1] * scale * 0.3 * xHeight;
        if (isLetter(letters[i]) && isLetter(letters[i + 1])) {
          const joined = strokes.some((stroke) => {
            const box = boxOfStrokes([stroke]);
            return box !== null && box.x0 < before && box.x1 > after;
          });
          pairs.push({ pair: letters[i] + letters[i + 1], joined });
        }
        at = next;
      }
    }
    // The word's baseline: the lowest ink above the descenders' reach.
    const ys: number[] = [];
    for (const stroke of strokes) {
      for (let i = 1; i < stroke.length; i += 4) {
        const y = stroke[i];
        if (y < sample.baseline + 0.3 * xHeight && y > sample.baseline - 1.4 * xHeight) ys.push(y);
      }
    }
    if (ys.length > 4) {
      ys.sort((a, b) => a - b);
      baselines.push((ys[Math.floor(ys.length * 0.95)] - sample.baseline) / xHeight);
    }
  });
  return { wordGaps, letterGaps, pairs, baselines };
}

const sd = (values: readonly number[]) => spread(values, { mean: 0, sd: 0 }).sd;

/** The measures of the calibration page's writing. */
export function measure(progress: Progress): HandMetrics {
  const all = charSamples(progress).filter((s) => s.kind === 'char' && s.sample.strokes.length > 0);
  const d = DEFAULT_METRICS;
  const small = pick(all, X_HEIGHT_LETTERS)
    .map(heightAbove)
    .filter((h) => h > 0);
  const xHeight = small.length > 0 ? median(small) : median(all.map((s) => s.sample.guide)) || d.xHeight;
  const ratio = (list: number[], fallback: number) => (list.length > 0 ? median(list) / xHeight : fallback);
  const capHeight = ratio(pick(all, CAP_LETTERS).map(heightAbove), d.capHeight);
  const ascender = ratio(pick(all, ASCENDER_LETTERS).map(heightAbove), d.ascender);
  const descender = ratio(
    pick(all, DESCENDER_LETTERS).map((s) => s.box.y1 - s.sample.baseline),
    d.descender,
  );
  // How much one character's size and angle change from one time it is written to the next.
  const byChar = new Map<string, CharSample[]>();
  for (const s of all) byChar.set(s.char, [...(byChar.get(s.char) ?? []), s]);
  const sizeSpread: number[] = [];
  const angleSpread: number[] = [];
  for (const [char, list] of byChar) {
    if (list.length < 2 || !/^[\p{L}\p{N}]$/u.test(char)) continue;
    const heights = list.map((s) => s.box.y1 - s.box.y0);
    const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
    if (mean > 0) sizeSpread.push(sd(heights) / mean);
    const slants = list.map((s) => slantOf(s.sample.strokes)).filter((v): v is number => v !== null);
    if (slants.length > 1) angleSpread.push(sd(slants));
  }
  const slants: number[] = [];
  const pressures: number[] = [];
  let length = 0;
  let ms = 0;
  const sentences = SENTENCES.map((_, n) => progress.samples[`sentence:${n}`]).filter((s): s is RawSample => !!s);
  for (const sample of [...all.map((s) => s.sample), ...sentences]) {
    const slant = slantOf(sample.strokes);
    if (slant !== null) slants.push(slant);
    for (const stroke of sample.strokes) {
      for (let i = 2; i < stroke.length; i += 4) pressures.push(stroke[i]);
      const motion = strokeMotion(stroke);
      if (motion.ms > 0) {
        length += motion.length;
        ms += motion.ms;
      }
    }
  }
  // Each box's baseline: the bottom of the ink of letters and digits that sit on the line.
  const boxBaselines = all
    .filter((s) => /^[\p{L}\p{N}]$/u.test(s.char) && !DESCENDER_LETTERS.includes(s.char) && !'QJ'.includes(s.char))
    .map((s) => (s.box.y1 - s.sample.baseline) / xHeight);
  const widthOf = (char: string) => {
    const widths = (byChar.get(char) ?? []).map((s) => (s.box.x1 - s.box.x0) / xHeight);
    return widths.length > 0 ? median(widths) : 0.6;
  };
  const wordGaps: number[] = [];
  const letterGaps: number[] = [];
  const pairs: { pair: string; joined: boolean }[] = [];
  const wordBaselines: number[] = [];
  sentences.forEach((sample) => {
    const n = SENTENCES.findIndex((_, i) => progress.samples[`sentence:${i}`] === sample);
    const found = measureSentence(sample, SENTENCES[n], widthOf, xHeight);
    if (!found) return;
    wordGaps.push(...found.wordGaps);
    letterGaps.push(...found.letterGaps);
    pairs.push(...found.pairs);
    const mid = median(found.baselines);
    wordBaselines.push(...found.baselines.map((b) => b - mid));
  });
  const joinRate = pairs.length > 0 ? pairs.filter((p) => p.joined).length / pairs.length : 0;
  const counts = new Map<string, { joined: number; seen: number }>();
  for (const { pair, joined } of pairs) {
    const count = counts.get(pair) ?? { joined: 0, seen: 0 };
    count.seen += 1;
    if (joined) count.joined += 1;
    counts.set(pair, count);
  }
  const joins: Record<string, number> = {};
  for (const [pair, count] of counts) joins[pair] = (count.joined + joinRate) / (count.seen + 1);
  const wobble = Math.sqrt(
    (sd(boxBaselines) ** 2 + (wordBaselines.length > 1 ? sd(wordBaselines) ** 2 : sd(boxBaselines) ** 2)) / 2,
  );
  const slant = spread(slants, d.slant);
  return {
    xHeight,
    capHeight: clampTo(capHeight, 0.8, 4),
    ascender: clampTo(ascender, 0.8, 4),
    descender: clampTo(descender, 0, 3),
    slant: { mean: clampTo(slant.mean, -45, 45), sd: clampTo(slant.sd, 0, 30) },
    letterGap: clampSpread(spread(letterGaps, d.letterGap), -0.3, 1.2),
    wordGap: clampSpread(spread(wordGaps, d.wordGap), 0.2, 4),
    baselineWobble: clampTo(Number.isFinite(wobble) ? wobble : d.baselineWobble, 0, 0.4),
    sizeJitter: clampTo(sizeSpread.length > 0 ? median(sizeSpread) : d.sizeJitter, 0, 0.3),
    angleJitter: clampTo(angleSpread.length > 0 ? median(angleSpread) : d.angleJitter, 0, 12),
    pressure: spread(pressures, d.pressure),
    speed: ms > 0 ? clampTo(length / xHeight / (ms / 1000), 0.1, 500) : d.speed,
    joinRate,
    joins,
  };
}

const clampTo = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const clampSpread = (s: Spread, lo: number, hi: number): Spread => ({
  mean: clampTo(s.mean, lo, hi),
  sd: clampTo(s.sd, 0, hi - lo),
});

/** Makes the style from a finished calibration page. Letters added from uploads and the math habits are kept. */
export function buildStyle(progress: Progress, previous: HandStyle | null, now: number): HandStyle | null {
  if (!isComplete(progress)) return null;
  const metrics = measure(progress);
  const glyphs: Record<string, GlyphSample[]> = {};
  for (const s of charSamples(progress)) {
    const normal = normalizeSample(s.sample, metrics.xHeight);
    // The Math and science section asks for brackets a fourth and fifth time, written tall.
    const glyph = normal && s.kind === 'math' && s.n >= SAMPLES_PER_CHAR ? { ...normal, tall: true } : normal;
    if (glyph) glyphs[s.char] = [...(glyphs[s.char] ?? []), glyph].slice(0, LIMITS.variantsPerChar);
  }
  for (const [char, list] of Object.entries(previous?.glyphs ?? {})) {
    const kept = list.filter((g) => g.source === 'upload');
    if (kept.length > 0) glyphs[char] = [...(glyphs[char] ?? []), ...kept].slice(0, LIMITS.variantsPerChar);
  }
  return {
    glyphs,
    metrics,
    math: previous?.math ?? DEFAULT_HABITS,
    calibratedAt: previous?.calibratedAt && previous.calibratedAt > 0 ? previous.calibratedAt : now,
    updatedAt: now,
  };
}

/** A symbol the person confirmed from an upload: its strokes in page units, and the line it sits on. */
export interface ConfirmedSymbol {
  readonly char: string;
  readonly strokes: readonly (readonly HandPoint[])[];
  readonly baseline: number;
  readonly xHeight: number;
}

/** Adds confirmed symbols to a style. Uploads only ever add: they never make a style. */
export function withSymbols(style: HandStyle, symbols: readonly ConfirmedSymbol[], now: number): HandStyle {
  const glyphs: Record<string, GlyphSample[]> = Object.fromEntries(
    Object.entries(style.glyphs).map(([char, list]) => [char, [...list]]),
  );
  for (const symbol of symbols) {
    if ([...symbol.char].length !== 1 || !(symbol.xHeight > 0)) continue;
    const flat = symbol.strokes
      .filter((s) => s.length > 0)
      .slice(0, LIMITS.strokesPerGlyph)
      .map((s) => flatten(s.slice(0, LIMITS.pointsPerStroke)));
    const glyph = normalizeSample(
      { strokes: flat, baseline: symbol.baseline, guide: symbol.xHeight, width: 1, height: 1, at: now },
      symbol.xHeight,
      'upload',
    );
    if (!glyph) continue;
    // The newest uploads win when a character is full, and the pen's own samples always stay.
    const list = glyphs[symbol.char] ?? [];
    const pen = list.filter((g) => g.source === 'pen');
    const uploads = [...list.filter((g) => g.source === 'upload'), glyph];
    glyphs[symbol.char] = [...pen, ...uploads.slice(-Math.max(1, LIMITS.variantsPerChar - pen.length))].slice(
      -LIMITS.variantsPerChar,
    );
  }
  return { ...style, glyphs, updatedAt: now };
}

/** The characters a style has samples for. */
export const knownChars = (style: HandStyle | null): Set<string> => new Set(Object.keys(style?.glyphs ?? {}));

/** The calibration characters a style is missing, which can happen when a stored style was damaged. */
export const missingCalibration = (style: HandStyle): string[] => CALIBRATION_CHARS.filter((c) => !style.glyphs[c]);

export { clamp01 };
