// A person's handwriting style (flag ink.myHandwriting): the letters they wrote, as strokes with pressure and time, and
// the measures of how they write. It is kept only on this device, encrypted, and never synced, exported, indexed, or
// logged; the view's store module is the only thing that reads or writes it. This file is the data and its checks: a
// stored document is read as untrusted, so every field is checked and capped before anything uses it.

/** A stroke as flat numbers: x, y, pressure, and time for each point. */
export type FlatStroke = number[];

/** One point of a stroke. */
export interface HandPoint {
  readonly x: number;
  readonly y: number;
  /** Pressure, 0 to 1. */
  readonly p: number;
  /** Milliseconds from the start of the sample. */
  readonly t: number;
}

/** What the pen wrote in one box of the calibration page, in the box's own pixels. */
export interface RawSample {
  readonly strokes: FlatStroke[];
  /** The y of the box's baseline. */
  readonly baseline: number;
  /** The distance from the baseline to the box's faint middle line, the size the box suggests for small letters. */
  readonly guide: number;
  readonly width: number;
  readonly height: number;
  /** When it was written, Unix milliseconds. */
  readonly at: number;
}

/**
 * One way the person writes a character. Strokes are in x-height units: x from the left edge of the ink, y down from
 * the baseline, so a point above the baseline has a negative y.
 */
export interface GlyphSample {
  readonly strokes: FlatStroke[];
  /** The width of the ink. */
  readonly width: number;
  /** Where it came from: the calibration page, the Math and science section, or an upload the person confirmed. */
  readonly source: 'pen' | 'upload';
  /** A bracket or root written tall, which only the math layout uses, for tall contents. */
  readonly tall?: boolean;
}

export interface Spread {
  readonly mean: number;
  readonly sd: number;
}

/** How the person writes. Lengths are in x-height units unless they say otherwise. */
export interface HandMetrics {
  /** The x-height as written on the calibration page, in its pixels. */
  readonly xHeight: number;
  readonly capHeight: number;
  readonly ascender: number;
  /** How far descenders reach below the baseline. */
  readonly descender: number;
  /** Degrees from upright; positive leans right. */
  readonly slant: Spread;
  readonly letterGap: Spread;
  readonly wordGap: Spread;
  /** How much the baseline wanders: the spread of each word's baseline. */
  readonly baselineWobble: number;
  /** How much a letter's size varies, as a fraction of its size. */
  readonly sizeJitter: number;
  /** How much a letter's angle varies, in degrees. */
  readonly angleJitter: number;
  readonly pressure: Spread;
  /** How fast the pen moves, in x-heights a second. */
  readonly speed: number;
  /** How often two letters of a word are joined. */
  readonly joinRate: number;
  /** For a pair of letters, how often they were joined. */
  readonly joins: Readonly<Record<string, number>>;
}

/** How the person lays out math, from their uploads; until then, a common hand's habits. */
export interface MathHabits {
  /** The size of a superscript or subscript, as a fraction of the letter it is on. */
  readonly scriptScale: number;
  /** How high a superscript's baseline sits, in x-heights. */
  readonly supRaise: number;
  /** How low a subscript's baseline sits. */
  readonly subDrop: number;
  /** The space between a fraction bar and the numerator or denominator. */
  readonly fracGap: number;
  /** How far a fraction bar reaches past the wider of the two. */
  readonly fracOverhang: number;
  /** The space between the columns of a matrix. */
  readonly matrixColGap: number;
  /** The space between the rows of a matrix or of aligned equations. */
  readonly matrixRowGap: number;
  /** The size of a big operator (integral, sum, product), as a multiple of the cap height. */
  readonly bigOpScale: number;
  /** The size of the limits under and over a sum, as a fraction. */
  readonly limitScale: number;
}

export interface HandStyle {
  readonly glyphs: Readonly<Record<string, readonly GlyphSample[]>>;
  readonly metrics: HandMetrics;
  readonly math: MathHabits;
  /** When the calibration page was finished. */
  readonly calibratedAt: number;
  readonly updatedAt: number;
}

/** The calibration page so far: each box's writing, so the person can stop and come back. */
export interface Progress {
  readonly samples: Readonly<Record<string, RawSample>>;
  /** The step the person was on. */
  readonly step: number;
}

/** An upload the person chose to keep with the style. */
export interface KeptUpload {
  readonly name: string;
  readonly type: string;
  /** The file, base64. */
  readonly data: string;
  readonly at: number;
}

/** Everything the store keeps: the style once there is one, the calibration so far, and kept uploads. */
export interface StyleDoc {
  readonly version: 1;
  readonly style: HandStyle | null;
  readonly progress: Progress;
  readonly kept: readonly KeptUpload[];
}

export const DOC_VERSION = 1;
/** Caps on a stored document, so a damaged or hostile file can't use up memory or time. */
export const LIMITS = {
  variantsPerChar: 12,
  strokesPerGlyph: 40,
  pointsPerStroke: 4000,
  chars: 600,
  samples: 1200,
  keptUploads: 20,
  keptBytes: 30 * 1024 * 1024,
} as const;

export const DEFAULT_HABITS: MathHabits = {
  scriptScale: 0.68,
  supRaise: 0.95,
  subDrop: 0.45,
  fracGap: 0.32,
  fracOverhang: 0.18,
  matrixColGap: 1.3,
  matrixRowGap: 0.9,
  bigOpScale: 1.55,
  limitScale: 0.62,
};

export const DEFAULT_METRICS: HandMetrics = {
  xHeight: 24,
  capHeight: 1.5,
  ascender: 1.65,
  descender: 0.6,
  slant: { mean: 0, sd: 2 },
  letterGap: { mean: 0.18, sd: 0.06 },
  wordGap: { mean: 0.9, sd: 0.15 },
  baselineWobble: 0.04,
  sizeJitter: 0.05,
  angleJitter: 1.5,
  pressure: { mean: 0.55, sd: 0.12 },
  speed: 6,
  joinRate: 0,
  joins: {},
};

export const emptyDoc = (): StyleDoc => ({
  version: DOC_VERSION,
  style: null,
  progress: { samples: {}, step: 0 },
  kept: [],
});

/** A stroke's points. A trailing partial point is dropped. */
export function pointsOf(stroke: FlatStroke): HandPoint[] {
  const out: HandPoint[] = [];
  for (let i = 0; i + 3 < stroke.length; i += 4)
    out.push({ x: stroke[i], y: stroke[i + 1], p: stroke[i + 2], t: stroke[i + 3] });
  return out;
}

const round = (v: number, places: number) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

/** A stroke as flat numbers, rounded so the stored document stays small. */
export function flatten(points: readonly HandPoint[]): FlatStroke {
  const out: FlatStroke = [];
  for (const p of points) out.push(round(p.x, 3), round(p.y, 3), round(clamp01(p.p), 3), Math.round(p.t));
  return out;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0.5);

// ---- Reading a stored document, as untrusted data ----

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown, fallback: number, lo = -1e6, hi = 1e6): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

function readStroke(value: unknown): FlatStroke | null {
  if (!Array.isArray(value) || value.length < 4 || value.length > LIMITS.pointsPerStroke * 4) return null;
  const out: FlatStroke = [];
  for (let i = 0; i + 3 < value.length; i += 4) {
    const [x, y, p, t] = [value[i], value[i + 1], value[i + 2], value[i + 3]];
    if (![x, y, p, t].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    out.push(finite(x, 0, -1e5, 1e5), finite(y, 0, -1e5, 1e5), clamp01(p as number), finite(t, 0, 0, 1e8));
  }
  return out;
}

function readStrokes(value: unknown): FlatStroke[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.strokesPerGlyph) return null;
  const strokes = value.map(readStroke);
  return strokes.every((s): s is FlatStroke => s !== null) ? strokes : null;
}

function readGlyph(value: unknown): GlyphSample | null {
  if (!isObject(value)) return null;
  const strokes = readStrokes(value.strokes);
  if (!strokes) return null;
  const glyph: GlyphSample = {
    strokes,
    width: finite(value.width, 0, 0, 100),
    source: value.source === 'upload' ? 'upload' : 'pen',
  };
  return value.tall === true ? { ...glyph, tall: true } : glyph;
}

function readSpread(value: unknown, fallback: Spread, lo: number, hi: number): Spread {
  if (!isObject(value)) return fallback;
  return { mean: finite(value.mean, fallback.mean, lo, hi), sd: finite(value.sd, fallback.sd, 0, hi - lo) };
}

function readMetrics(value: unknown): HandMetrics {
  const d = DEFAULT_METRICS;
  if (!isObject(value)) return d;
  const joins: Record<string, number> = {};
  if (isObject(value.joins)) {
    for (const [pair, p] of Object.entries(value.joins).slice(0, 4000)) {
      if ([...pair].length === 2 && typeof p === 'number' && Number.isFinite(p)) joins[pair] = clamp01(p);
    }
  }
  return {
    xHeight: finite(value.xHeight, d.xHeight, 1, 1000),
    capHeight: finite(value.capHeight, d.capHeight, 0.8, 4),
    ascender: finite(value.ascender, d.ascender, 0.8, 4),
    descender: finite(value.descender, d.descender, 0, 3),
    slant: readSpread(value.slant, d.slant, -45, 45),
    letterGap: readSpread(value.letterGap, d.letterGap, -1, 3),
    wordGap: readSpread(value.wordGap, d.wordGap, 0, 6),
    baselineWobble: finite(value.baselineWobble, d.baselineWobble, 0, 1),
    sizeJitter: finite(value.sizeJitter, d.sizeJitter, 0, 0.5),
    angleJitter: finite(value.angleJitter, d.angleJitter, 0, 20),
    pressure: readSpread(value.pressure, d.pressure, 0, 1),
    speed: finite(value.speed, d.speed, 0.01, 1000),
    joinRate: clamp01(finite(value.joinRate, 0)),
    joins,
  };
}

function readHabits(value: unknown): MathHabits {
  const d = DEFAULT_HABITS;
  if (!isObject(value)) return d;
  const pick = (key: keyof MathHabits, lo: number, hi: number) => finite(value[key], d[key], lo, hi);
  return {
    scriptScale: pick('scriptScale', 0.3, 1),
    supRaise: pick('supRaise', 0.2, 3),
    subDrop: pick('subDrop', 0, 2),
    fracGap: pick('fracGap', 0, 2),
    fracOverhang: pick('fracOverhang', 0, 2),
    matrixColGap: pick('matrixColGap', 0.2, 6),
    matrixRowGap: pick('matrixRowGap', 0.1, 6),
    bigOpScale: pick('bigOpScale', 0.8, 4),
    limitScale: pick('limitScale', 0.3, 1),
  };
}

function readStyle(value: unknown): HandStyle | null {
  if (!isObject(value) || !isObject(value.glyphs)) return null;
  const glyphs: Record<string, GlyphSample[]> = {};
  for (const [char, list] of Object.entries(value.glyphs).slice(0, LIMITS.chars)) {
    if ([...char].length !== 1 || !Array.isArray(list)) continue;
    const variants = list
      .slice(0, LIMITS.variantsPerChar)
      .map(readGlyph)
      .filter((g): g is GlyphSample => g !== null);
    if (variants.length > 0) glyphs[char] = variants;
  }
  return {
    glyphs,
    metrics: readMetrics(value.metrics),
    math: readHabits(value.math),
    calibratedAt: finite(value.calibratedAt, 0, 0, 1e15),
    updatedAt: finite(value.updatedAt, 0, 0, 1e15),
  };
}

function readSample(value: unknown): RawSample | null {
  if (!isObject(value)) return null;
  const strokes = readStrokes(value.strokes);
  if (!strokes) return null;
  return {
    strokes,
    baseline: finite(value.baseline, 0, 0, 1e4),
    guide: finite(value.guide, 1, 1, 1e4),
    width: finite(value.width, 1, 1, 1e5),
    height: finite(value.height, 1, 1, 1e4),
    at: finite(value.at, 0, 0, 1e15),
  };
}

function readKept(value: unknown): KeptUpload[] {
  if (!Array.isArray(value)) return [];
  let bytes = 0;
  const out: KeptUpload[] = [];
  for (const item of value.slice(0, LIMITS.keptUploads)) {
    if (!isObject(item) || typeof item.data !== 'string' || typeof item.name !== 'string') continue;
    bytes += item.data.length;
    if (bytes > LIMITS.keptBytes * 1.4) break;
    out.push({
      name: item.name.slice(0, 200),
      type: typeof item.type === 'string' ? item.type.slice(0, 100) : '',
      data: item.data,
      at: finite(item.at, 0, 0, 1e15),
    });
  }
  return out;
}

/** A stored document, checked. Null for something that is not one. */
export function parseDoc(value: unknown): StyleDoc | null {
  if (!isObject(value) || value.version !== DOC_VERSION) return null;
  const samples: Record<string, RawSample> = {};
  const progress = isObject(value.progress) ? value.progress : {};
  if (isObject(progress.samples)) {
    for (const [id, sample] of Object.entries(progress.samples).slice(0, LIMITS.samples)) {
      const read = readSample(sample);
      if (read && /^(char|math|sentence):[\d:]{1,12}$/.test(id)) samples[id] = read;
    }
  }
  return {
    version: DOC_VERSION,
    style: value.style === null ? null : readStyle(value.style),
    progress: { samples, step: finite(progress.step, 0, 0, 1000) },
    kept: readKept(value.kept),
  };
}
