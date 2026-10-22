// The writer: text in, the person's handwriting out, as ordinary strokes. Each character takes one of the ways the
// person wrote it, never the same one twice running when there are others. Size, angle, and baseline change a
// little, within the ranges their calibration showed. Letters and words are spaced as theirs are, and letters join
// with a smooth curve where their sentences joined them. Lines wrap at the width given and step down as the paper's
// lines do. A character the person never wrote comes from the neutral hand and is listed, so they can add it.
import { neutralGlyph } from './neutral';
import { pointsOf } from './style';
import type { GlyphSample, HandPoint, HandStyle } from './style';

/** A seeded random source (mulberry32), so the same text and seed give the same writing. */
export type Rand = () => number;
export function seeded(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A normal deviate, cut at two spreads so no letter is ever far out. */
export function gauss(rand: Rand, mean: number, sd: number): number {
  const u = Math.max(1e-9, rand());
  const v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + Math.max(-2, Math.min(2, z)) * sd;
}

/** A point of written ink: page units, pressure 0 to 1, milliseconds from the start of the writing. */
export interface InkOut {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly time: number;
}

export type InkPath = InkOut[];

/** Where writing goes. */
export interface Placement {
  /** The left edge of every line. */
  readonly left: number;
  /** How wide a line may be. */
  readonly width: number;
  /** The baseline of the first line. */
  readonly baseline: number;
  /** The x-height in page units. */
  readonly xHeight: number;
  /** The baseline of the line after one at `y`. */
  readonly next: (y: number) => number;
  /** Where the first line starts, when not at its left edge (writing that goes on from earlier writing). */
  readonly startX?: number;
}

/** A piece of writing laid out by the math layout: glyphs and lines in x-height units around a baseline at 0. */
export interface Figure {
  readonly width: number;
  /** How far it reaches above the baseline and below it, in x-heights. */
  readonly ascent: number;
  readonly descent: number;
  readonly paths: InkPath[];
  readonly missing: readonly string[];
}

export type Run =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'figure'; readonly figure: Figure; readonly display: boolean };

export interface Written {
  readonly paths: InkPath[];
  /** Characters that came from the neutral hand, each once, in the order met. */
  readonly missing: string[];
  /** Where the next character would go. */
  readonly end: { x: number; baseline: number };
  readonly lines: number;
}

/** One character laid out: which glyph, and where its paths go before placement. */
export interface PlacedGlyph {
  readonly char: string;
  readonly glyph: GlyphSample;
  readonly neutral: boolean;
}

/** Picks the glyph for a character: one of the person's, or the neutral hand's. */
export class GlyphPicker {
  private last = new Map<string, number>();
  readonly missing = new Set<string>();
  constructor(
    private readonly style: HandStyle | null,
    private readonly rand: Rand,
  ) {}

  pick(char: string): PlacedGlyph | null {
    // Tall brackets are for the math layout's tall contents, so they are left out unless they are all there is.
    const all = this.style?.glyphs[char];
    const regular = all?.filter((g) => !g.tall);
    const own = regular && regular.length > 0 ? regular : all;
    if (own && own.length > 0) {
      const previous = this.last.get(char) ?? -1;
      let index = Math.floor(this.rand() * own.length);
      if (own.length > 1 && index === previous)
        index = (index + 1 + Math.floor(this.rand() * (own.length - 1))) % own.length;
      this.last.set(char, index);
      return { char, glyph: own[index], neutral: false };
    }
    const neutral = neutralGlyph(char) ?? neutralGlyph(char.normalize('NFD')[0] ?? '');
    this.missing.add(char);
    return neutral ? { char, glyph: neutral, neutral: true } : null;
  }
}

/** A glyph's strokes moved to the page: scaled, turned by `angle` degrees about its baseline, and placed. */
export function placeGlyph(
  glyph: GlyphSample,
  x: number,
  baseline: number,
  scale: number,
  angle: number,
  t0: number,
): InkPath[] {
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return glyph.strokes.map((stroke) =>
    pointsOf(stroke).map((p) => ({
      x: x + (p.x * cos - p.y * sin) * scale,
      y: baseline + (p.x * sin + p.y * cos) * scale,
      pressure: p.p,
      time: t0 + p.t,
    })),
  );
}

const isLetter = (char: string) => /^\p{L}$/u.test(char);

/** The smooth curve from the end of one stroke into the start of the next, as the pen would join them. */
export function joinPaths(a: InkPath, b: InkPath): InkPath {
  const p0 = a[a.length - 1];
  const p3 = b[0];
  const before = a[Math.max(0, a.length - 3)];
  const after = b[Math.min(b.length - 1, 2)];
  const reach = Math.hypot(p3.x - p0.x, p3.y - p0.y) * 0.4;
  const dir = (from: InkOut, to: InkOut) => {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
  };
  const d0 = dir(before, p0);
  const d1 = dir(p3, after);
  const c1 = { x: p0.x + d0.x * reach, y: p0.y + d0.y * reach };
  const c2 = { x: p3.x - d1.x * reach, y: p3.y - d1.y * reach };
  const bridge: InkPath = [];
  const steps = 6;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    bridge.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
      pressure: p0.pressure * u + p3.pressure * t,
      time: p0.time + (Math.max(p3.time, p0.time + 1) - p0.time) * t,
    });
  }
  const shiftT = Math.max(0, bridge[bridge.length - 1].time + 8 - p3.time);
  return [...a, ...bridge, ...b.map((p) => ({ ...p, time: p.time + shiftT }))];
}

/** Whether a glyph's last stroke ends low and to the right, and the next's first starts low and to the left: a join. */
function joinable(prev: GlyphSample, next: GlyphSample): boolean {
  const end = pointsOf(prev.strokes[prev.strokes.length - 1]).at(-1);
  const start = pointsOf(next.strokes[0])[0];
  return (
    !!end && !!start && end.y > -0.8 && start.y > -1.1 && end.x >= prev.width * 0.45 && start.x <= next.width * 0.55
  );
}

interface WordGlyph {
  readonly char: string;
  readonly placed: PlacedGlyph;
  readonly scale: number;
  readonly angle: number;
  readonly x: number;
  readonly joined: boolean;
}

/** The writer's state as it goes along a text. */
class Pen {
  paths: InkPath[] = [];
  x: number;
  baseline: number;
  lines = 1;
  time = 0;
  readonly rand: Rand;
  readonly picker: GlyphPicker;
  private readonly extraMissing = new Set<string>();

  constructor(
    readonly style: HandStyle | null,
    readonly place: Placement,
    seed: number,
  ) {
    this.rand = seeded(seed);
    this.picker = new GlyphPicker(style, this.rand);
    this.x = place.startX ?? place.left;
    this.baseline = place.baseline;
  }

  get metrics() {
    return this.style?.metrics;
  }

  get xh(): number {
    return this.place.xHeight;
  }

  newLine(): void {
    this.x = this.place.left;
    this.baseline = this.place.next(this.baseline);
    this.lines += 1;
  }

  letterGap(): number {
    const g = this.metrics?.letterGap ?? { mean: 0.18, sd: 0.04 };
    return Math.max(-0.2, gauss(this.rand, g.mean, g.sd)) * this.xh;
  }

  wordGap(): number {
    const g = this.metrics?.wordGap ?? { mean: 0.9, sd: 0.12 };
    return Math.max(0.3, gauss(this.rand, g.mean, g.sd)) * this.xh;
  }

  /** Lays out a word without placing it: its glyphs, each one's position from the word's start, and its width. */
  layoutWord(word: string): { glyphs: WordGlyph[]; width: number } {
    const m = this.metrics;
    const glyphs: WordGlyph[] = [];
    let x = 0;
    let prev: WordGlyph | null = null;
    for (const char of word) {
      const placed = this.picker.pick(char);
      if (!placed) continue;
      const scale = this.xh * Math.max(0.7, gauss(this.rand, 1, m?.sizeJitter ?? 0.04));
      const angle = gauss(this.rand, 0, m?.angleJitter ?? 1.2);
      const joinChance = prev ? (m?.joins[prev.char + char] ?? m?.joinRate ?? 0) : 0;
      const joined =
        !!prev &&
        !placed.neutral &&
        !prev.placed.neutral &&
        isLetter(prev.char) &&
        isLetter(char) &&
        (m?.joinRate ?? 0) > 0.05 &&
        this.rand() < joinChance &&
        joinable(prev.placed.glyph, placed.glyph);
      if (prev) x += joined ? Math.min(this.letterGap(), 0.08 * this.xh) : this.letterGap();
      const item: WordGlyph = { char, placed, scale, angle, x, joined };
      glyphs.push(item);
      x += placed.glyph.width * scale;
      prev = item;
    }
    return { glyphs, width: x };
  }

  /** Puts a laid-out word on the page at the pen. */
  putWord(word: { glyphs: WordGlyph[]; width: number }): void {
    const wobble = gauss(this.rand, 0, (this.metrics?.baselineWobble ?? 0.03) * this.xh);
    const baseline = this.baseline + wobble;
    for (const g of word.glyphs) {
      const paths = placeGlyph(g.placed.glyph, this.x + g.x, baseline, g.scale, g.angle, this.time);
      if (paths.length === 0) continue;
      const end = Math.max(...paths.flatMap((path) => path.map((p) => p.time)));
      if (g.joined && this.paths.length > 0) {
        const last = this.paths.pop()!;
        this.paths.push(joinPaths(last, paths[0]), ...paths.slice(1));
      } else this.paths.push(...paths);
      this.time = end + 90;
    }
    this.x += word.width;
  }

  write(text: string): void {
    const parts = text.replace(/\r\n?/g, '\n').split(/(\n| +|\t)/);
    let atLineStart = this.x <= this.place.left + 1e-6;
    for (const part of parts) {
      if (part === '') continue;
      if (part === '\n') {
        this.newLine();
        atLineStart = true;
        continue;
      }
      if (/^[ \t]+$/.test(part)) {
        if (!atLineStart) for (let i = 0; i < part.length; i++) this.x += this.wordGap();
        continue;
      }
      const word = this.layoutWord(part);
      const right = this.place.left + this.place.width;
      if (!atLineStart && this.x + word.width > right) {
        this.newLine();
      }
      if (word.width > this.place.width) {
        this.putLongWord(word);
      } else this.putWord(word);
      atLineStart = false;
    }
  }

  /** A word wider than a whole line is broken where it reaches the edge. */
  private putLongWord(word: { glyphs: WordGlyph[]; width: number }): void {
    const right = this.place.left + this.place.width;
    let piece: WordGlyph[] = [];
    let offset = 0;
    const flush = () => {
      const last = piece[piece.length - 1];
      if (last) this.putWord({ glyphs: piece, width: last.x + last.placed.glyph.width * last.scale });
    };
    for (const g of word.glyphs) {
      const x = g.x - offset;
      if (piece.length > 0 && this.x + x + g.placed.glyph.width * g.scale > right) {
        flush();
        this.newLine();
        offset = g.x;
        piece = [{ ...g, x: 0, joined: false }];
      } else piece.push({ ...g, x });
    }
    flush();
  }

  /** A figure (math) inline, or on lines of its own when it is display math. */
  figure(figure: Figure, display: boolean): void {
    for (const char of figure.missing) this.extraMissing.add(char);
    const width = figure.width * this.xh;
    const right = this.place.left + this.place.width;
    if (display && this.x > this.place.left + 1e-6) this.newLine();
    else if (!display && this.x > this.place.left + 1e-6 && this.x + width > right) this.newLine();
    // A tall figure takes the lines it needs: it sits low enough that its top clears the line above.
    const lineStep = this.place.next(this.baseline) - this.baseline;
    const extraAbove = Math.max(0, figure.ascent * this.xh - lineStep * 0.75);
    let steps = Math.ceil(extraAbove / Math.max(1, lineStep));
    while (steps-- > 0) this.newLine();
    for (const path of figure.paths) {
      this.paths.push(
        path.map((p) => ({
          x: this.x + p.x * this.xh,
          y: this.baseline + p.y * this.xh,
          pressure: p.pressure,
          time: this.time + p.time,
        })),
      );
    }
    this.time += Math.max(0, ...figure.paths.flatMap((path) => path.map((p) => p.time))) + 120;
    this.x += width;
    const extraBelow = Math.max(0, figure.descent * this.xh - lineStep * 0.45);
    steps = Math.ceil(extraBelow / Math.max(1, lineStep));
    while (steps-- > 0) this.newLine();
    if (display) this.newLine();
    else this.x += this.letterGap();
  }

  result(): Written {
    const missing = [...this.picker.missing, ...this.extraMissing].filter(
      (c, i, all) => all.indexOf(c) === i && c.trim() !== '',
    );
    return {
      paths: this.paths.filter((p) => p.length > 0),
      missing,
      end: { x: this.x, baseline: this.baseline },
      lines: this.lines,
    };
  }
}

/** Writes text and math in the person's hand. `style` null writes everything in the neutral hand. */
export function writeRuns(runs: readonly Run[], style: HandStyle | null, place: Placement, seed: number): Written {
  const pen = new Pen(style, place, seed);
  for (const run of runs) {
    if (run.kind === 'text') pen.write(run.text);
    else pen.figure(run.figure, run.display);
  }
  return pen.result();
}

/** Writes plain text. */
export const writeText = (text: string, style: HandStyle | null, place: Placement, seed: number): Written =>
  writeRuns([{ kind: 'text', text }], style, place, seed);

/** A glyph in x-height units around a baseline at 0, for the math layout and previews. */
export function glyphPaths(glyph: GlyphSample, x: number, baseline: number, scale: number): InkPath[] {
  return placeGlyph(glyph, x, baseline, scale, 0, 0);
}

export type { HandPoint };
