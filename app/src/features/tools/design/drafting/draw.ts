// Turns a drafting document into drawing primitives in sheet millimetres with y down (screen orientation), which the
// editor draws as React elements and the export writes as an SVG file. Sharing one list keeps the picture on the page
// and the exported picture the same.
import {
  LINE_TYPES,
  SHEET_MM,
  TITLE_KEYS,
  anchors,
  deg,
  dimText,
  findEntity,
  hatchLines,
  measure,
  outline,
  rectCorners,
} from './model';
import type { DraftingDoc, Dim, LineType, Pt, TitleKey } from './model';

export interface PathPrim {
  t: 'path';
  d: string;
  /** Stroke width in millimetres and the dash lengths. */
  weight: number;
  dash: readonly number[];
  fill: 'none' | 'ink';
  /** The entity or dimension this belongs to, for selection. */
  owner: string | null;
  role: 'geometry' | 'dimension' | 'hatch' | 'frame';
}

export interface TextPrim {
  t: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  /** Degrees, counterclockwise on the sheet. */
  angle: number;
  anchor: 'start' | 'middle' | 'end';
  owner: string | null;
}

export type Prim = PathPrim | TextPrim;

export interface TitleLabels {
  title: string;
  drawnBy: string;
  date: string;
  scale: string;
  sheet: string;
  material: string;
  tolerance: string;
}

const TEXT_HEIGHT = 3.5;
const ARROW_LENGTH = 3;
const ARROW_HALF = 0.5;
const EXT_GAP = 1;
const EXT_OVER = 2;

const r3 = (n: number): string => String(Math.round(n * 1000) / 1000);

/** The sheet size of a document in millimetres. */
export function sheetSize(doc: DraftingDoc): { w: number; h: number } {
  const [w, h] = SHEET_MM[doc.sheet];
  return { w, h };
}

function seg(
  d: string[],
  w: number,
  role: PathPrim['role'],
  lt: LineType,
  owner: string | null,
  fill: PathPrim['fill'] = 'none',
): PathPrim {
  const style = LINE_TYPES[lt];
  return { t: 'path', d: d.join(''), weight: w || style.weight, dash: style.dash, fill, owner, role };
}

/** An arrowhead whose tip is at `tip`, pointing along `angle` (radians, sheet orientation). */
function arrow(tip: Pt, angle: number, H: number): string {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const bx = tip[0] - ux * ARROW_LENGTH;
  const by = tip[1] - uy * ARROW_LENGTH;
  const p = (x: number, y: number) => `${r3(x)} ${r3(H - y)}`;
  return `M${p(tip[0], tip[1])}L${p(bx - uy * ARROW_HALF, by + ux * ARROW_HALF)}L${p(bx + uy * ARROW_HALF, by - ux * ARROW_HALF)}Z`;
}

function upright(angle: number): number {
  let a = ((angle % 360) + 360) % 360;
  if (a > 180) a -= 360;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
}

function dimPrims(dim: Dim, doc: DraftingDoc, H: number): Prim[] {
  const m = measure(dim, doc);
  if (typeof m === 'string') return [];
  const g = m.geom;
  const out: Prim[] = [];
  const P = (p: Pt) => `${r3(p[0])} ${r3(H - p[1])}`;
  const text = dimText(dim, m.value, doc);
  const owner = dim.id;
  const line = (a: Pt, b: Pt, lt: LineType) => out.push(seg([`M${P(a)}L${P(b)}`], 0, 'dimension', lt, owner));
  switch (g.k) {
    case 'aligned': {
      for (const [from, to] of [
        [g.a, g.a2],
        [g.b, g.b2],
      ] as const) {
        const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
        if (len < 1e-6) continue;
        const ux = (to[0] - from[0]) / len;
        const uy = (to[1] - from[1]) / len;
        line(
          [from[0] + ux * EXT_GAP, from[1] + uy * EXT_GAP],
          [to[0] + ux * EXT_OVER, to[1] + uy * EXT_OVER],
          'extension',
        );
      }
      line(g.a2, g.b2, 'dimension');
      const ang = Math.atan2(g.b2[1] - g.a2[1], g.b2[0] - g.a2[0]);
      if (Math.hypot(g.b2[0] - g.a2[0], g.b2[1] - g.a2[1]) > 1e-6) {
        out.push(seg([arrow(g.a2, ang + Math.PI, H)], 0.3, 'dimension', 'dimension', owner, 'ink'));
        out.push(seg([arrow(g.b2, ang, H)], 0.3, 'dimension', 'dimension', owner, 'ink'));
      }
      const a = upright(g.angle);
      const nx = -Math.sin((a * Math.PI) / 180);
      const ny = Math.cos((a * Math.PI) / 180);
      out.push({
        t: 'text',
        x: g.text[0] + nx * 1.5,
        y: H - (g.text[1] + ny * 1.5),
        text,
        size: TEXT_HEIGHT,
        angle: a,
        anchor: 'middle',
        owner,
      });
      break;
    }
    case 'angular': {
      const a0 = (g.from * Math.PI) / 180;
      const a1 = (g.to * Math.PI) / 180;
      const s: Pt = [g.center[0] + g.r * Math.cos(a0), g.center[1] + g.r * Math.sin(a0)];
      const e: Pt = [g.center[0] + g.r * Math.cos(a1), g.center[1] + g.r * Math.sin(a1)];
      const large = g.to - g.from > 180 ? 1 : 0;
      out.push(seg([`M${P(s)}A${r3(g.r)} ${r3(g.r)} 0 ${large} 0 ${P(e)}`], 0, 'dimension', 'dimension', owner));
      out.push(seg([arrow(s, a0 - Math.PI / 2, H)], 0.3, 'dimension', 'dimension', owner, 'ink'));
      out.push(seg([arrow(e, a1 + Math.PI / 2, H)], 0.3, 'dimension', 'dimension', owner, 'ink'));
      for (const p of [g.p1, g.p2]) {
        const d = Math.hypot(p[0] - g.center[0], p[1] - g.center[1]);
        if (d < g.r + EXT_OVER) {
          const ux = (p[0] - g.center[0]) / (d || 1);
          const uy = (p[1] - g.center[1]) / (d || 1);
          line(p, [g.center[0] + ux * (g.r + EXT_OVER), g.center[1] + uy * (g.r + EXT_OVER)], 'extension');
        }
      }
      out.push({
        t: 'text',
        x: g.text[0],
        y: H - g.text[1],
        text,
        size: TEXT_HEIGHT,
        angle: 0,
        anchor: 'middle',
        owner,
      });
      break;
    }
    case 'radius': {
      line(g.center, g.end, 'leader');
      out.push(
        seg(
          [arrow(g.edge, Math.atan2(g.edge[1] - g.center[1], g.edge[0] - g.center[0]), H)],
          0.3,
          'dimension',
          'leader',
          owner,
          'ink',
        ),
      );
      const cos = Math.cos((g.angle * Math.PI) / 180);
      out.push({
        t: 'text',
        x: g.text[0] + (cos >= 0 ? 1 : -1),
        y: H - g.text[1],
        text,
        size: TEXT_HEIGHT,
        angle: 0,
        anchor: cos >= 0 ? 'start' : 'end',
        owner,
      });
      break;
    }
    case 'diameter': {
      line(g.p, g.q, 'dimension');
      const ang = Math.atan2(g.q[1] - g.p[1], g.q[0] - g.p[0]);
      out.push(seg([arrow(g.q, ang, H)], 0.3, 'dimension', 'dimension', owner, 'ink'));
      out.push(seg([arrow(g.p, ang + Math.PI, H)], 0.3, 'dimension', 'dimension', owner, 'ink'));
      const cos = Math.cos((g.angle * Math.PI) / 180);
      out.push({
        t: 'text',
        x: g.text[0] + (cos >= 0 ? 1 : -1),
        y: H - g.text[1],
        text,
        size: TEXT_HEIGHT,
        angle: 0,
        anchor: cos >= 0 ? 'start' : 'end',
        owner,
      });
      break;
    }
  }
  return out;
}

function titleBlock(doc: DraftingDoc, labels: TitleLabels, W: number, H: number): Prim[] {
  const width = Math.min(180, W * 0.62);
  const height = Math.min(36, H * 0.2);
  const x0 = W - 5 - width;
  const y0 = 5; // bottom edge in sheet orientation, 5 mm up from the bottom
  const P = (x: number, y: number) => `${r3(x)} ${r3(H - y)}`;
  const out: Prim[] = [];
  const box = (x: number, y: number, w: number, h: number, weight: number) =>
    out.push({
      t: 'path',
      d: `M${P(x, y)}L${P(x + w, y)}L${P(x + w, y + h)}L${P(x, y + h)}Z`,
      weight,
      dash: [],
      fill: 'none',
      owner: null,
      role: 'frame',
    });
  const hline = (xa: number, xb: number, y: number) =>
    out.push({
      t: 'path',
      d: `M${P(xa, y)}L${P(xb, y)}`,
      weight: 0.3,
      dash: [],
      fill: 'none',
      owner: null,
      role: 'frame',
    });
  const vline = (x: number, ya: number, yb: number) =>
    out.push({
      t: 'path',
      d: `M${P(x, ya)}L${P(x, yb)}`,
      weight: 0.3,
      dash: [],
      fill: 'none',
      owner: null,
      role: 'frame',
    });
  box(x0, y0, width, height, 0.6);
  // Rows from the top: title (40 percent), four short fields (30 percent), material and the tolerance note (30 percent).
  const yTitle = y0 + height * 0.6;
  const yMid = y0 + height * 0.3;
  hline(x0, x0 + width, yTitle);
  hline(x0, x0 + width, yMid);
  for (const f of [0.35, 0.6, 0.8]) vline(x0 + f * width, yMid, yTitle);
  vline(x0 + 0.4 * width, y0, yMid);
  const field = (key: TitleKey, fx: number, top: number, rowH: number) => {
    const x = x0 + fx * width + 1.2;
    out.push({
      t: 'text',
      x,
      y: H - (top - 2.2),
      text: labels[key],
      size: 1.8,
      angle: 0,
      anchor: 'start',
      owner: null,
    });
    if (doc.title[key]) {
      out.push({
        t: 'text',
        x,
        y: H - (top - rowH + 2.2),
        text: doc.title[key],
        size: key === 'title' ? 4.5 : 3,
        angle: 0,
        anchor: 'start',
        owner: null,
      });
    }
  };
  field('title', 0, y0 + height, height * 0.4);
  field('drawnBy', 0, yTitle, height * 0.3);
  field('date', 0.35, yTitle, height * 0.3);
  field('scale', 0.6, yTitle, height * 0.3);
  field('sheet', 0.8, yTitle, height * 0.3);
  field('material', 0, yMid, height * 0.3);
  field('tolerance', 0.4, yMid, height * 0.3);
  return out;
}

/** Every primitive of a document: the sheet frame, the title block, the geometry, the hatching and the dimensions. */
export function drawDoc(doc: DraftingDoc, labels: TitleLabels): Prim[] {
  const { w: W, h: H } = sheetSize(doc);
  const P = (p: Pt) => `${r3(p[0])} ${r3(H - p[1])}`;
  const out: Prim[] = [];
  out.push({
    t: 'path',
    d: `M${r3(5)} ${r3(5)}L${r3(W - 5)} ${r3(5)}L${r3(W - 5)} ${r3(H - 5)}L${r3(5)} ${r3(H - 5)}Z`,
    weight: 0.6,
    dash: [],
    fill: 'none',
    owner: null,
    role: 'frame',
  });
  out.push(...titleBlock(doc, labels, W, H));
  for (const e of doc.entities) {
    switch (e.k) {
      case 'line':
        out.push(seg([`M${P(e.a)}L${P(e.b)}`], 0, 'geometry', e.lt, e.id));
        break;
      case 'rect': {
        const c = rectCorners(e.a, e.b);
        out.push(seg([`M${P(c[0])}L${P(c[1])}L${P(c[2])}L${P(c[3])}Z`], 0, 'geometry', e.lt, e.id));
        break;
      }
      case 'poly':
        out.push(seg([`M${e.pts.map(P).join('L')}`, e.closed ? 'Z' : ''], 0, 'geometry', e.lt, e.id));
        break;
      case 'circle': {
        const l: Pt = [e.c[0] - e.r, e.c[1]];
        const r: Pt = [e.c[0] + e.r, e.c[1]];
        out.push(
          seg(
            [`M${P(l)}A${r3(e.r)} ${r3(e.r)} 0 1 0 ${P(r)}A${r3(e.r)} ${r3(e.r)} 0 1 0 ${P(l)}`],
            0,
            'geometry',
            e.lt,
            e.id,
          ),
        );
        break;
      }
      case 'arc': {
        const [, s, en] = anchors(e);
        const sweep = (((e.a1 - e.a0) % 360) + 360) % 360 || 360;
        out.push(
          seg([`M${P(s!.p)}A${r3(e.r)} ${r3(e.r)} 0 ${sweep > 180 ? 1 : 0} 0 ${P(en!.p)}`], 0, 'geometry', e.lt, e.id),
        );
        break;
      }
      case 'note':
        out.push({
          t: 'text',
          x: e.p[0],
          y: H - e.p[1],
          text: e.text,
          size: TEXT_HEIGHT,
          angle: 0,
          anchor: 'start',
          owner: e.id,
        });
        break;
      case 'hatch': {
        const poly = outline(findEntity(doc, e.of));
        if (!poly) break;
        const lines = hatchLines(poly, e.spacing, e.angle);
        if (lines.length > 0) {
          out.push({
            t: 'path',
            d: lines.map(([a, b]) => `M${P(a)}L${P(b)}`).join(''),
            weight: 0.3,
            dash: [],
            fill: 'none',
            owner: e.id,
            role: 'hatch',
          });
        }
        break;
      }
    }
  }
  for (const d of doc.dims) out.push(...dimPrims(d, doc, H));
  return out;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A standalone SVG file of the drawing: black lines on white paper at the sheet's true size in millimetres. */
export function toSvg(doc: DraftingDoc, labels: TitleLabels, alt: string): string {
  const { w, h } = sheetSize(doc);
  const body = drawDoc(doc, labels)
    .map((p) => {
      if (p.t === 'text') {
        const rot = p.angle !== 0 ? ` transform="rotate(${r3(-p.angle)} ${r3(p.x)} ${r3(p.y)})"` : '';
        return `<text x="${r3(p.x)}" y="${r3(p.y)}" font-size="${p.size}" text-anchor="${p.anchor}"${rot}>${esc(p.text)}</text>`;
      }
      const dash = p.dash.length > 0 ? ` stroke-dasharray="${p.dash.join(' ')}"` : '';
      const fill = p.fill === 'ink' ? 'currentColor' : 'none';
      return `<path d="${p.d}" fill="${fill}" stroke="currentColor" stroke-width="${p.weight}"${dash} stroke-linejoin="round"/>`;
    })
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(alt)}" ` +
    `color="#000" font-family="Arial, Helvetica, sans-serif"><title>${esc(alt)}</title><rect width="${w}" height="${h}" fill="#fff"/>${body}</svg>`
  );
}

/** Angles shown by the editor for a line at the pointer: degrees from the +x axis, 0 to 360. */
export function bearing(a: Pt, b: Pt): number {
  const d = deg(Math.atan2(b[1] - a[1], b[0] - a[0]));
  return (d + 360) % 360;
}

export { TITLE_KEYS };
