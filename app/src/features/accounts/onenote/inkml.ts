// OneNote's ink, as Microsoft Graph gives it when a page is asked for with InkML: traces of points with a brush for
// each. This reads the traces into strokes in page pixels. InkML writes numbers three ways (whole values, and the
// first or second difference from the point before), and all three are read. Units are HIMETRIC (0.01 mm) unless a
// brush or channel says otherwise.

/** The part of the HTML reader's element that ink needs. */
export interface InkEl {
  tag: string;
  attrs: Record<string, string>;
  children: (InkEl | string)[];
}

export interface InkSpec {
  points: { x: number; y: number; pressure?: number }[];
  /** Red, green, blue, and alpha bytes. */
  color: [number, number, number, number];
  /** The nominal width in page pixels. */
  width: number;
  highlighter: boolean;
}

const PX_PER_HIMETRIC = 96 / 2540;
const UNIT_TO_PX: Record<string, number> = {
  himetric: PX_PER_HIMETRIC,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
  pt: 96 / 72,
  px: 1,
};
const MAX_POINTS = 20_000;
const MAX_STROKES = 5_000;

const local = (tag: string): string => tag.slice(tag.indexOf(':') + 1);

function walk(el: InkEl, visit: (one: InkEl) => void): void {
  visit(el);
  for (const child of el.children) if (typeof child !== 'string') walk(child, visit);
}

function textOf(el: InkEl): string {
  return el.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

interface Brush {
  color: [number, number, number, number];
  width: number;
  highlighter: boolean;
}

const DEFAULT_BRUSH: Brush = { color: [0, 0, 0, 255], width: 1.5, highlighter: false };

function parseColor(value: string): [number, number, number] | null {
  const found = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value.trim());
  if (!found) return null;
  const n = parseInt(found[1] ?? '0', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readBrush(el: InkEl): Brush {
  const brush: Brush = { ...DEFAULT_BRUSH, color: [...DEFAULT_BRUSH.color] };
  let transparency = 0;
  walk(el, (one) => {
    if (local(one.tag) !== 'brushproperty') return;
    const name = (one.attrs.name ?? '').toLowerCase();
    const value = one.attrs.value ?? '';
    if (name === 'color') {
      const rgb = parseColor(value);
      if (rgb) [brush.color[0], brush.color[1], brush.color[2]] = rgb;
    } else if (name === 'width' || name === 'height') {
      const size = Number(value);
      const scale = UNIT_TO_PX[(one.attrs.units ?? 'himetric').toLowerCase()] ?? PX_PER_HIMETRIC;
      if (Number.isFinite(size) && size > 0 && name === 'width') brush.width = Math.max(0.5, size * scale);
    } else if (name === 'transparency') {
      const amount = Number(value);
      if (Number.isFinite(amount)) transparency = Math.min(255, Math.max(0, amount));
    } else if (name === 'rasterop') {
      brush.highlighter = value.toLowerCase() === 'maskpen';
    } else if (name === 'tip' && value.toLowerCase() === 'rectangle') {
      brush.highlighter = true;
    }
  });
  brush.color[3] = Math.round(255 - transparency);
  if (brush.highlighter && brush.color[3] === 255) brush.color[3] = 128;
  return brush;
}

interface Layout {
  x: number;
  y: number;
  f: number;
  count: number;
}

function layoutOf(el: InkEl | undefined): Layout {
  const layout: Layout = { x: 0, y: 1, f: -1, count: 3 };
  if (!el) return layout;
  const names: string[] = [];
  walk(el, (one) => {
    if (local(one.tag) === 'channel') names.push((one.attrs.name ?? '').toUpperCase());
  });
  if (names.length === 0) return layout;
  const x = names.indexOf('X');
  const y = names.indexOf('Y');
  return { x: x < 0 ? 0 : x, y: y < 0 ? 1 : y, f: names.indexOf('F'), count: names.length };
}

/** The points of one trace's text: points are separated by commas, a point's values by spaces. */
export function parseTrace(text: string, layout: Layout, scale: number): InkSpec['points'] {
  const value: number[] = [];
  const speed: number[] = [];
  const mode: ('!' | "'" | '"')[] = [];
  const points: InkSpec['points'] = [];
  for (const raw of text.split(',')) {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    for (let at = 0; at < layout.count && at < tokens.length; at += 1) {
      let token = tokens[at] ?? '';
      const first = token[0];
      if (first === '!' || first === "'" || first === '"') {
        mode[at] = first;
        token = token.slice(1);
      } else if (first === '*' || first === '?') {
        token = '';
      }
      if (token === '') {
        if (mode[at] === '"') {
          speed[at] = speed[at] ?? 0;
          value[at] = (value[at] ?? 0) + (speed[at] ?? 0);
        }
        continue;
      }
      const number = Number(token);
      if (!Number.isFinite(number)) continue;
      const current = mode[at] ?? '!';
      if (current === '!') {
        value[at] = number;
        speed[at] = 0;
      } else if (current === "'") {
        speed[at] = number;
        value[at] = (value[at] ?? 0) + number;
      } else {
        speed[at] = (speed[at] ?? 0) + number;
        value[at] = (value[at] ?? 0) + (speed[at] ?? 0);
      }
    }
    const x = value[layout.x];
    const y = value[layout.y];
    if (x === undefined || y === undefined) continue;
    const force = layout.f >= 0 ? value[layout.f] : undefined;
    points.push({
      x: Math.round(x * scale * 100) / 100,
      y: Math.round(y * scale * 100) / 100,
      ...(force !== undefined && force > 0 ? { pressure: Math.min(1, force / 1023) } : {}),
    });
    if (points.length >= MAX_POINTS) break;
  }
  return points;
}

/** The strokes in one InkML element. */
export function parseInk(root: InkEl): InkSpec[] {
  const brushes = new Map<string, Brush>();
  let layoutEl: InkEl | undefined;
  let lastBrush: Brush = DEFAULT_BRUSH;
  let scale = PX_PER_HIMETRIC;
  walk(root, (one) => {
    const name = local(one.tag);
    if (name === 'brush') {
      const brush = readBrush(one);
      brushes.set(one.attrs['xml:id'] ?? one.attrs.id ?? '', brush);
      lastBrush = brush;
    } else if (name === 'traceformat' && !layoutEl) {
      layoutEl = one;
    } else if (name === 'channel' && (one.attrs.name ?? '').toUpperCase() === 'X' && one.attrs.units) {
      scale = UNIT_TO_PX[one.attrs.units.toLowerCase()] ?? scale;
    }
  });
  const layout = layoutOf(layoutEl);
  const strokes: InkSpec[] = [];
  walk(root, (one) => {
    if (local(one.tag) !== 'trace' || strokes.length >= MAX_STROKES) return;
    const points = parseTrace(textOf(one), layout, scale);
    if (points.length === 0) return;
    const ref = (one.attrs.brushref ?? '').replace(/^#/, '');
    const brush = brushes.get(ref) ?? lastBrush;
    strokes.push({
      points,
      color: [...brush.color],
      width: brush.width,
      highlighter: brush.highlighter,
    });
  });
  return strokes;
}

/** True for an element that holds InkML. */
export const isInk = (tag: string): boolean => local(tag) === 'ink' && (tag === 'ink' || tag.startsWith('inkml:'));
