// Geometry for the wireframe tests, in plain Node. It reads the SVG the generator wrote and flattens each shape
// to points in the picture's own coordinates. It answers the questions the app's drawing tests answer in a
// browser: where is the lowest point, and how far apart are two shapes.

export interface Pt {
  x: number;
  y: number;
}

/** One continuous run of a shape's outline. */
export interface Run {
  pts: Pt[];
  closed: boolean;
}

export interface El {
  tag: string;
  attrs: Record<string, string>;
  children: El[];
  text: string;
  parent?: El;
}

/** Reads the generator's SVG, which is well formed and has no CDATA, entities beyond the XML five, or namespaces. */
export function parseSvg(svg: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [], text: '' };
  let at = root;
  for (const token of svg.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (token.startsWith('<?') || token.startsWith('<!')) continue;
    if (!token.startsWith('<')) {
      at.text += token.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      continue;
    }
    if (token.startsWith('</')) {
      at = at.parent ?? root;
      continue;
    }
    const tag = /^<([\w:-]+)/.exec(token)?.[1] ?? '';
    const attrs: Record<string, string> = {};
    for (const [, name, value] of token.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[name] = value;
    const el: El = { tag, attrs, children: [], text: '', parent: at };
    at.children.push(el);
    if (!token.endsWith('/>')) at = el;
  }
  return root;
}

export function* walk(el: El): Generator<El> {
  yield el;
  for (const child of el.children) yield* walk(child);
}

export const named = (root: El, part: string) => [...walk(root)].filter((e) => e.attrs['data-part'] === part);

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function transformOf(text: string | undefined): Matrix {
  let m = IDENTITY;
  for (const [, kind, args] of (text ?? '').matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (kind === 'translate') m = multiply(m, [1, 0, 0, 1, v[0], v[1] ?? 0]);
    else if (kind === 'scale') m = multiply(m, [v[0], 0, 0, v[1] ?? v[0], 0, 0]);
    else if (kind === 'rotate') {
      const a = (v[0] * Math.PI) / 180;
      const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
      const turn: Matrix = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
      m = multiply(multiply(multiply(m, [1, 0, 0, 1, cx, cy]), turn), [1, 0, 0, 1, -cx, -cy]);
    } else if (kind === 'matrix') m = multiply(m, v as Matrix);
  }
  return m;
}

/** The matrix that takes an element's own coordinates to the picture's. */
export function toPicture(el: El): Matrix {
  const chain: El[] = [];
  for (let e: El | undefined = el; e; e = e.parent) chain.unshift(e);
  return chain.reduce((m, e) => multiply(m, transformOf(e.attrs.transform)), IDENTITY);
}

/** The scale a matrix applies, for the shapes that only scale uniformly. */
export const scaleOf = (m: Matrix) => Math.hypot(m[0], m[1]);

const apply = (m: Matrix, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

const STEPS = 200;

function arc(from: Pt, to: Pt, rxIn: number, ryIn: number, turn: number, large: boolean, sweep: boolean): Pt[] {
  if (rxIn === 0 || ryIn === 0) return [to];
  const phi = (turn * Math.PI) / 180;
  const [c, s] = [Math.cos(phi), Math.sin(phi)];
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = c * dx + s * dy;
  const y1 = -s * dx + c * dy;
  let [rx, ry] = [Math.abs(rxIn), Math.abs(ryIn)];
  const grow = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (grow > 1) [rx, ry] = [rx * Math.sqrt(grow), ry * Math.sqrt(grow)];
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = c * cx1 - s * cy1 + (from.x + to.x) / 2;
  const cy = s * cx1 + c * cy1 + (from.y + to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let span = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && span > 0) span -= 2 * Math.PI;
  if (sweep && span < 0) span += 2 * Math.PI;
  return Array.from({ length: STEPS }, (_, i) => {
    const a = start + (span * (i + 1)) / STEPS;
    return { x: cx + rx * Math.cos(a) * c - ry * Math.sin(a) * s, y: cy + rx * Math.cos(a) * s + ry * Math.sin(a) * c };
  });
}

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** Flattens path data into runs of points. Curves are sampled 200 times, which is finer than any test needs. */
export function flatten(d: string): Run[] {
  const runs: Run[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let first = cur;
  let lastC: Pt | undefined;
  let lastQ: Pt | undefined;
  const open = (p: Pt) => {
    runs.push({ pts: [p], closed: false });
    cur = first = p;
  };
  const add = (...pts: Pt[]) => {
    runs.at(-1)?.pts.push(...pts);
    cur = pts[pts.length - 1];
  };
  const sample = (at: (t: number) => Pt) => Array.from({ length: STEPS }, (_, i) => at((i + 1) / STEPS));
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = '';
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    const lower = cmd.toLowerCase();
    const rel = cmd === lower;
    const v = tokens.slice(i, i + ARGS[lower]).map(Number);
    i += ARGS[lower];
    const px = (n: number) => n + (rel ? cur.x : 0);
    const py = (n: number) => n + (rel ? cur.y : 0);
    const from = cur;
    let nextC: Pt | undefined;
    let nextQ: Pt | undefined;
    if (lower === 'm') {
      open({ x: px(v[0]), y: py(v[1]) });
    } else if (lower === 'l') {
      add({ x: px(v[0]), y: py(v[1]) });
    } else if (lower === 'h') {
      add({ x: rel ? cur.x + v[0] : v[0], y: cur.y });
    } else if (lower === 'v') {
      add({ x: cur.x, y: rel ? cur.y + v[0] : v[0] });
    } else if (lower === 'c' || lower === 's') {
      const c1 =
        lower === 'c'
          ? { x: px(v[0]), y: py(v[1]) }
          : lastC
            ? { x: 2 * from.x - lastC.x, y: 2 * from.y - lastC.y }
            : from;
      const o = lower === 'c' ? 2 : 0;
      const c2 = { x: px(v[o]), y: py(v[o + 1]) };
      const to = { x: px(v[o + 2]), y: py(v[o + 3]) };
      add(
        ...sample((t) => {
          const u = 1 - t;
          const [a, b, e, f] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
          return {
            x: a * from.x + b * c1.x + e * c2.x + f * to.x,
            y: a * from.y + b * c1.y + e * c2.y + f * to.y,
          };
        }),
      );
      nextC = c2;
    } else if (lower === 'q' || lower === 't') {
      const c1 =
        lower === 'q'
          ? { x: px(v[0]), y: py(v[1]) }
          : lastQ
            ? { x: 2 * from.x - lastQ.x, y: 2 * from.y - lastQ.y }
            : from;
      const o = lower === 'q' ? 2 : 0;
      const to = { x: px(v[o]), y: py(v[o + 1]) };
      add(
        ...sample((t) => {
          const u = 1 - t;
          return {
            x: u * u * from.x + 2 * u * t * c1.x + t * t * to.x,
            y: u * u * from.y + 2 * u * t * c1.y + t * t * to.y,
          };
        }),
      );
      nextQ = c1;
    } else if (lower === 'a') {
      add(...arc(from, { x: px(v[5]), y: py(v[6]) }, v[0], v[1], v[2], v[3] !== 0, v[4] !== 0));
    } else if (lower === 'z') {
      const last = runs.at(-1);
      if (last) last.closed = true;
      cur = first;
      if (tokens[i] !== undefined && !/[a-zA-Z]/.test(tokens[i])) throw new Error(`Numbers after z in "${d}"`);
    }
    lastC = nextC;
    lastQ = nextQ;
  }
  return runs;
}

/** The outline of a drawn shape (path, line, rect, circle, ellipse) in the picture's coordinates. */
export function outlineOf(el: El): Run[] {
  const a = el.attrs;
  const n = (name: string) => Number(a[name] ?? 0);
  let runs: Run[] = [];
  if (el.tag === 'path') runs = flatten(a.d ?? '');
  else if (el.tag === 'line')
    runs = [
      {
        pts: [
          { x: n('x1'), y: n('y1') },
          { x: n('x2'), y: n('y2') },
        ],
        closed: false,
      },
    ];
  else if (el.tag === 'rect') {
    const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
    runs = [
      {
        pts: [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
        closed: true,
      },
    ];
  } else if (el.tag === 'circle' || el.tag === 'ellipse') {
    const [rx, ry] = [n(el.tag === 'circle' ? 'r' : 'rx'), n(el.tag === 'circle' ? 'r' : 'ry')];
    const pts = Array.from({ length: 360 }, (_, i) => ({
      x: n('cx') + rx * Math.cos((i * Math.PI) / 180),
      y: n('cy') + ry * Math.sin((i * Math.PI) / 180),
    }));
    runs = [{ pts, closed: true }];
  }
  const m = toPicture(el);
  return runs.map((r) => ({ closed: r.closed, pts: r.pts.map((p) => apply(m, p)) }));
}

export const SHAPES = new Set(['path', 'line', 'rect', 'circle', 'ellipse']);

/** Every point of every shape under an element. */
export const pointsUnder = (el: El): Pt[] =>
  [...walk(el)].filter((e) => SHAPES.has(e.tag)).flatMap((e) => outlineOf(e).flatMap((r) => r.pts));

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** The closest approach of two sets of points. */
export function gapBetween(a: Pt[], b: Pt[]): number {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, dist(p, q));
  return best;
}

/**
 * Points every `step` along a shape's runs, closing the closed ones. A straight line flattens to its two ends, so a
 * gap measured to it needs the points in between.
 */
export function densify(runs: Run[], step = 0.1): Pt[] {
  return runs.flatMap(({ pts, closed }) => {
    const line = closed ? [...pts, pts[0]] : pts;
    const out = [line[0]];
    for (let i = 1; i < line.length; i++) {
      const [a, b] = [line[i - 1], line[i]];
      const n = Math.max(1, Math.ceil(dist(a, b) / step));
      for (let j = 1; j <= n; j++) out.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n });
    }
    return out;
  });
}

/** Whether a point is inside a closed outline, by the even-odd rule. */
export function within(p: Pt, outline: Pt[]): boolean {
  let odd = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [a, b] = [outline[i], outline[j]];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
  }
  return odd;
}

export const lowest = (pts: Pt[]) => Math.max(...pts.map((p) => p.y));

/** The y of the top edge of a flat line or slab at x, from its outline. */
export function topAt(pts: Pt[], x: number): number {
  return Math.min(...pts.filter((p) => Math.abs(p.x - x) <= 0.5).map((p) => p.y));
}

/** Where text sits, estimated from its size: a character is about half its size wide, and it rises and falls a little. */
export function textBox(el: El): { x0: number; y0: number; x1: number; y1: number } {
  const size = Number(el.attrs['font-size'] ?? 13);
  const width = el.text.length * size * 0.5;
  const x = Number(el.attrs.x);
  const anchor = el.attrs['text-anchor'];
  const x0 = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
  const [mx, my] = [toPicture(el)[4], toPicture(el)[5]];
  const y = Number(el.attrs.y);
  return { x0: x0 + mx, x1: x0 + width + mx, y0: y - size * 0.8 + my, y1: y + size * 0.25 + my };
}
