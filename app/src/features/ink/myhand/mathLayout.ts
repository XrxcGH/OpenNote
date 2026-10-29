// Typed math laid out as handwritten math, with real math structure. Fractions get their bar and scripts sit raised or
// lowered. A root's sign reaches over the whole radicand, and integrals and sums carry their limits. Brackets grow as
// tall as what they hold, matrices keep rows and columns, and aligned lines line up at their & marks. Sizes and
// offsets come from the person's math habits (from their uploads, or a common hand's until then). Everything is in
// x-height units with the baseline at 0 and y down; the writer scales it to the page.
import { parseLatex } from './latex';
import type { MathNode } from './latex';
import { DEFAULT_HABITS, pointsOf } from './style';
import type { GlyphSample, HandStyle, MathHabits } from './style';
import { GlyphPicker, seeded } from './write';
import type { Figure, InkPath, Rand } from './write';

/** A glyph placed at a baseline, scaled, and stretched to a height when it is a bracket or a root. */
type Item =
  | {
      readonly k: 'g';
      readonly glyph: GlyphSample;
      readonly x: number;
      readonly y: number;
      readonly s: number;
      readonly sy?: number;
    }
  | { readonly k: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };

interface Box {
  readonly w: number;
  /** Above the baseline. */
  readonly a: number;
  /** Below the baseline. */
  readonly d: number;
  readonly items: readonly Item[];
}

const EMPTY: Box = { w: 0, a: 0, d: 0, items: [] };
/** The math axis, where fraction bars and the middle of brackets sit, above the baseline. */
const AXIS = 0.5;

function extent(glyph: GlyphSample): { top: number; bottom: number } {
  let top = Infinity;
  let bottom = -Infinity;
  for (const stroke of glyph.strokes) {
    for (const p of pointsOf(stroke)) {
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
  }
  return top <= bottom ? { top, bottom } : { top: -1, bottom: 0 };
}

function shift(box: Box, dx: number, dy: number): Item[] {
  return box.items.map((item) =>
    item.k === 'g'
      ? { ...item, x: item.x + dx, y: item.y + dy }
      : { ...item, x1: item.x1 + dx, x2: item.x2 + dx, y1: item.y1 + dy, y2: item.y2 + dy },
  );
}

class Layout {
  readonly picker: GlyphPicker;
  readonly habits: MathHabits;

  constructor(
    readonly style: HandStyle | null,
    readonly rand: Rand,
  ) {
    this.picker = new GlyphPicker(style, rand);
    this.habits = style?.math ?? DEFAULT_HABITS;
  }

  get letterGap(): number {
    return Math.max(0.06, Math.min(0.3, this.style?.metrics.letterGap.mean ?? 0.14));
  }

  /** One character at size `s`. */
  glyph(char: string, s: number): Box {
    const placed = this.picker.pick(char);
    if (!placed) return { w: 0.5 * s, a: 0, d: 0, items: [] };
    const { top, bottom } = extent(placed.glyph);
    return {
      w: placed.glyph.width * s,
      a: -top * s,
      d: Math.max(0, bottom * s),
      items: [{ k: 'g', glyph: placed.glyph, x: 0, y: 0, s }],
    };
  }

  /**
   * A bracket or root sign stretched to reach from `top` to `bottom` (y down). Of the person's variants it takes the
   * one written closest to that height, as they write small and tall brackets differently.
   */
  stretched(char: string, top: number, bottom: number, s: number, keepAspect = false): Box {
    const own = this.style?.glyphs[char];
    let glyph: GlyphSample | null;
    if (own && own.length > 0) {
      const want = (bottom - top) / s;
      glyph = [...own].sort((a, b) => {
        const ha = extent(a);
        const hb = extent(b);
        return Math.abs(ha.bottom - ha.top - want) - Math.abs(hb.bottom - hb.top - want);
      })[0];
    } else glyph = this.picker.pick(char)?.glyph ?? null;
    if (!glyph) return EMPTY;
    const e = extent(glyph);
    const height = Math.max(1e-3, e.bottom - e.top);
    const sy = (bottom - top) / height;
    // Wider for a much taller bracket, but never as much wider as it is taller.
    const sx = keepAspect ? sy : Math.min(sy, s * Math.max(1, Math.sqrt(sy / s)));
    const y = top - e.top * sy;
    return { w: glyph.width * sx, a: -top, d: Math.max(0, bottom), items: [{ k: 'g', glyph, x: 0, y, s: sx, sy }] };
  }

  /** Boxes side by side, with the gaps math puts around operators and relations. */
  hrow(nodes: readonly MathNode[], s: number): Box {
    const items: Item[] = [];
    let x = 0;
    let a = 0;
    let d = 0;
    let prev: MathNode | null = null;
    for (const node of nodes) {
      const box = this.node(node, s);
      if (box.w === 0 && box.items.length === 0 && node.t !== 'space') continue;
      if (prev) x += this.gap(prev, node) * s;
      items.push(...shift(box, x, 0));
      x += box.w;
      a = Math.max(a, box.a);
      d = Math.max(d, box.d);
      prev = node;
    }
    return { w: x, a, d, items };
  }

  gap(prev: MathNode, node: MathNode): number {
    const cls = (n: MathNode) => (n.t === 'sym' ? n.cls : n.t === 'op' ? 'op' : 'ord');
    const [p, n] = [cls(prev), cls(node)];
    if (prev.t === 'space' || node.t === 'space') return 0;
    if (p === 'rel' || n === 'rel') return 0.45;
    if (p === 'bin' || n === 'bin') return 0.35;
    if (p === 'punct') return 0.35;
    if (p === 'op') return 0.2;
    return this.letterGap;
  }

  node(node: MathNode, s: number): Box {
    switch (node.t) {
      case 'sym':
        return this.glyph(node.c, s);
      case 'row':
        return this.hrow(node.items, s);
      case 'text':
        return this.text(node.s, s);
      case 'space':
        return { w: node.w * s, a: 0, d: 0, items: [] };
      case 'frac':
        return this.frac(node.num, node.den, s);
      case 'scripts':
        return this.scripts(node, s);
      case 'sqrt':
        return this.sqrt(node.body, node.index, s);
      case 'op':
        return this.op(node.c, s);
      case 'delim':
        return this.delim(node.open, node.close, this.node(node.body, s), s);
      case 'matrix':
        return this.matrix(node.rows, node.open, node.close, node.align, s);
      case 'align':
        return this.align(node.rows, s);
      case 'accent':
        return this.accent(node.kind, node.body, s);
    }
  }

  text(text: string, s: number): Box {
    const nodes: MathNode[] = [];
    for (const char of text) nodes.push(char === ' ' ? { t: 'space', w: 0.6 } : { t: 'sym', c: char, cls: 'ord' });
    return this.hrow(nodes, s);
  }

  frac(numNode: MathNode, denNode: MathNode, s: number): Box {
    const inner = Math.max(0.5, s * 0.85);
    const num = this.node(numNode, inner);
    const den = this.node(denNode, inner);
    const over = this.habits.fracOverhang * s;
    const w = Math.max(num.w, den.w) + over * 2;
    const bar = -AXIS * s;
    const gap = this.habits.fracGap * s;
    const numBase = bar - gap - num.d;
    const denBase = bar + gap + den.a;
    const items: Item[] = [
      ...shift(num, (w - num.w) / 2, numBase),
      { k: 'line', x1: 0, y1: bar, x2: w, y2: bar },
      ...shift(den, (w - den.w) / 2, denBase),
    ];
    return { w: w + 0.1 * s, a: -(numBase - num.a), d: denBase + den.d, items };
  }

  isLimitBase(node: MathNode): boolean {
    return node.t === 'op' && node.limits;
  }

  scripts(node: Extract<MathNode, { t: 'scripts' }>, s: number): Box {
    const base = this.node(node.base, s);
    const small = Math.max(0.4, s * this.habits.scriptScale);
    if (this.isLimitBase(node.base)) {
      // Limits under and over a sum, a product, or lim.
      const ls = Math.max(0.4, s * this.habits.limitScale);
      const over = node.sup ? this.node(node.sup, ls) : EMPTY;
      const under = node.sub ? this.node(node.sub, ls) : EMPTY;
      const w = Math.max(base.w, over.w, under.w);
      const gap = 0.2 * s;
      const overBase = -base.a - gap - over.d;
      const underBase = base.d + gap + under.a;
      return {
        w,
        a: node.sup ? -(overBase - over.a) : base.a,
        d: node.sub ? underBase + under.d : base.d,
        items: [
          ...shift(base, (w - base.w) / 2, 0),
          ...shift(over, (w - over.w) / 2, overBase),
          ...shift(under, (w - under.w) / 2, underBase),
        ],
      };
    }
    const sup = node.sup ? this.node(node.sup, small) : null;
    const sub = node.sub ? this.node(node.sub, small) : null;
    const isIntegral = node.base.t === 'op' && node.base.c.startsWith('∫');
    let raise = Math.max(this.habits.supRaise * s, base.a - (sup?.a ?? 0) * 0.6);
    let drop = Math.max(this.habits.subDrop * s, base.d - (sub?.d ?? 0) * 0.2 + (sub ? sub.a * 0.25 : 0));
    if (isIntegral) {
      raise = base.a - (sup?.a ?? 0) * 0.4;
      drop = base.d - (sub?.d ?? 0) * 0.3;
    }
    if (sup && sub) {
      // Keep the two apart.
      const clash = -raise + sup.d - (drop - sub.a);
      if (clash > -0.15 * s) drop += clash + 0.15 * s;
    }
    const x = base.w + 0.05 * s;
    const items = [...base.items];
    if (sup) items.push(...shift(sup, x + (isIntegral ? 0.05 * s : 0), -raise));
    if (sub) items.push(...shift(sub, x - (isIntegral ? 0.15 * s : 0), drop));
    const w = x + Math.max(sup?.w ?? 0, sub?.w ?? 0);
    return {
      w,
      a: Math.max(base.a, sup ? raise + sup.a : 0),
      d: Math.max(base.d, sub ? drop + sub.d : 0),
      items,
    };
  }

  sqrt(bodyNode: MathNode, indexNode: MathNode | undefined, s: number): Box {
    const body = this.node(bodyNode, s);
    const top = -(Math.max(body.a, 1 * s) + 0.18 * s);
    const bottom = Math.max(body.d, 0.05 * s) + 0.05 * s;
    const sign = this.stretched('√', top, bottom, s);
    const index = indexNode ? this.node(indexNode, s * 0.5) : null;
    const lead = index ? Math.max(0, index.w - sign.w * 0.5) : 0;
    const x = lead + sign.w + 0.08 * s;
    const items: Item[] = [
      ...shift(sign, lead, 0),
      { k: 'line', x1: lead + sign.w - 0.04 * s, y1: top, x2: x + body.w + 0.1 * s, y2: top },
      ...shift(body, x, 0),
    ];
    if (index) items.push(...shift(index, 0, top * 0.45 - index.d));
    return { w: x + body.w + 0.15 * s, a: -top + 0.05 * s, d: bottom, items };
  }

  op(c: string, s: number): Box {
    if (/^[a-z]+$/.test(c)) return this.text(c, s);
    const size = this.habits.bigOpScale * (this.style?.metrics.capHeight ?? 1.45) * s;
    const isIntegral = c.startsWith('∫') || c === '∮';
    const height = isIntegral ? size * 1.35 : size * 0.85;
    // Centered on the axis.
    const top = -AXIS * s - height / 2;
    const bottom = top + height;
    const parts = [...c].map((char) => this.stretched(char, top, bottom, s, !isIntegral));
    let x = 0;
    const items: Item[] = [];
    for (const part of parts) {
      items.push(...shift(part, x, 0));
      x += part.w * (isIntegral ? 0.65 : 1);
    }
    const last = parts[parts.length - 1] ?? EMPTY;
    const w = isIntegral ? x + last.w * 0.35 : x;
    return { w, a: -top, d: Math.max(0, bottom), items };
  }

  delim(open: string, close: string, body: Box, s: number): Box {
    const reach = 0.12 * s;
    const top = -Math.max(body.a, 1.0 * s) - reach;
    const bottom = Math.max(body.d, 0.25 * s) + reach;
    const left = open ? this.stretched(open, top, bottom, s) : EMPTY;
    const right = close ? this.stretched(close, top, bottom, s) : EMPTY;
    const gap = 0.1 * s;
    const items = [...left.items, ...shift(body, left.w + gap, 0), ...shift(right, left.w + gap * 2 + body.w, 0)];
    return { w: left.w + body.w + right.w + gap * 2, a: -top, d: bottom, items };
  }

  grid(
    rows: readonly (readonly MathNode[])[],
    s: number,
    alignOf: (col: number) => 'left' | 'right' | 'center',
    colGap: number,
  ): Box {
    const cells = rows.map((r) => r.map((cell) => this.node(cell, s)));
    const cols = Math.max(0, ...cells.map((r) => r.length));
    const widths = Array.from({ length: cols }, (_, c) => Math.max(0, ...cells.map((r) => r[c]?.w ?? 0)));
    const rowGap = this.habits.matrixRowGap * s;
    const items: Item[] = [];
    let y = 0;
    let firstA = 0;
    cells.forEach((r, i) => {
      const a = Math.max(0.9 * s, ...r.map((c) => c.a));
      const d = Math.max(0.2 * s, ...r.map((c) => c.d));
      if (i === 0) firstA = a;
      else y += a;
      let x = 0;
      r.forEach((cell, c) => {
        const align = alignOf(c);
        const dx = align === 'left' ? 0 : align === 'right' ? widths[c] - cell.w : (widths[c] - cell.w) / 2;
        items.push(...shift(cell, x + dx, y));
        x += widths[c] + (c < cols - 1 ? colGap : 0);
      });
      y += d + rowGap;
    });
    const w = widths.reduce((sum, v) => sum + v, 0) + Math.max(0, cols - 1) * colGap;
    return { w, a: firstA, d: Math.max(0, y - rowGap), items };
  }

  matrix(
    rows: readonly (readonly MathNode[])[],
    open: string,
    close: string,
    align: 'center' | 'left',
    s: number,
  ): Box {
    const grid = this.grid(rows, s, () => align, this.habits.matrixColGap * s);
    // Centered on the axis.
    const dy = -AXIS * s - (grid.d - grid.a) / 2;
    const centred: Box = { w: grid.w, a: grid.a - dy, d: grid.d + dy, items: shift(grid, 0, dy) };
    return this.delim(open, close, centred, s);
  }

  align(rows: readonly (readonly MathNode[])[], s: number): Box {
    // Columns alternate right and left, so each line lines up at its & mark.
    return this.grid(rows, s, (c) => (c % 2 === 0 ? 'right' : 'left'), 0.15 * s);
  }

  accent(kind: 'vec' | 'hat' | 'dot' | 'bar' | 'tilde', bodyNode: MathNode, s: number): Box {
    const body = this.node(bodyNode, s);
    const y = -body.a - 0.22 * s;
    const items: Item[] = [...body.items];
    if (kind === 'bar') items.push({ k: 'line', x1: 0.05 * s, y1: y, x2: body.w - 0.02 * s, y2: y });
    else {
      const char = kind === 'vec' ? '⃗' : kind === 'hat' ? 'ˆ' : kind === 'dot' ? '˙' : '~';
      const mark = this.glyph(char, kind === 'vec' ? s * 0.8 : s * 0.6);
      const sx = kind === 'vec' ? Math.max(0.6, (body.w * 0.9) / Math.max(1e-3, mark.w)) : 1;
      const placed = mark.items.map((item) => (item.k === 'g' ? { ...item, s: item.s * sx, sy: item.s } : item));
      const w = mark.w * sx;
      items.push(...shift({ ...mark, items: placed }, (body.w - w) / 2, y - (kind === 'vec' ? 0 : mark.d)));
    }
    return { w: body.w, a: body.a + 0.4 * s, d: body.d, items };
  }
}

/** A hand-drawn straight line: a few points with a slight wander, so it reads as the pen's. */
function handLine(x1: number, y1: number, x2: number, y2: number, rand: Rand, t0: number): InkPath {
  const steps = 8;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = -(y2 - y1) / (len || 1);
  const ny = (x2 - x1) / (len || 1);
  const bow = (rand() - 0.5) * 0.04;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const off = Math.sin(Math.PI * t) * bow;
    return {
      x: x1 + (x2 - x1) * t + nx * off,
      y: y1 + (y2 - y1) * t + ny * off,
      pressure: 0.55,
      time: t0 + t * len * 120,
    };
  });
}

function render(box: Box, rand: Rand): InkPath[] {
  const paths: InkPath[] = [];
  let time = 0;
  // Written left to right, as a person writes an equation.
  const ordered = [...box.items].sort(
    (a, b) => (a.k === 'g' ? a.x : Math.min(a.x1, a.x2)) - (b.k === 'g' ? b.x : Math.min(b.x1, b.x2)),
  );
  for (const item of ordered) {
    if (item.k === 'line') {
      paths.push(handLine(item.x1, item.y1, item.x2, item.y2, rand, time));
      time += 300;
      continue;
    }
    const sy = item.sy ?? item.s;
    let end = time;
    for (const stroke of item.glyph.strokes) {
      const path = pointsOf(stroke).map((p) => ({
        x: item.x + p.x * item.s,
        y: item.y + p.y * sy,
        pressure: p.p,
        time: time + p.t,
      }));
      if (path.length > 0) {
        paths.push(path);
        end = Math.max(end, path[path.length - 1].time);
      }
    }
    time = end + 100;
  }
  return paths;
}

/** Lays out typed LaTeX in the person's hand. `display` math is a size larger, as it is on paper. */
export function mathFigure(latex: string, style: HandStyle | null, seed: number, display = false): Figure {
  const layout = new Layout(style, seeded(seed));
  const box = layout.node(parseLatex(latex), display ? 1.1 : 1);
  return {
    width: box.w,
    ascent: box.a,
    descent: box.d,
    paths: render(box, layout.rand),
    missing: [...layout.picker.missing],
  };
}
