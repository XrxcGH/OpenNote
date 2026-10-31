// Small vector diagrams for navigation problems: two bearing lines and where they cross, and the current
// triangle of water track, current, and ground track. North is up, as on a chart.
import { PAPER, r2, svgDocument, svgText } from '../svg';

interface Pt {
  x: number;
  y: number;
}

const SIZE = 320;
const PAD = 36;

function frame(points: readonly Pt[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const k = (SIZE - 2 * PAD) / span;
  return (p: Pt): Pt => ({ x: PAD + (p.x - minX) * k, y: SIZE - PAD - (p.y - minY) * k });
}

function line(a: Pt, b: Pt, color: string, dash = ''): string {
  const pattern = dash ? ` stroke-dasharray="${dash}"` : '';
  const ends = `x1="${r2(a.x)}" y1="${r2(a.y)}" x2="${r2(b.x)}" y2="${r2(b.y)}"`;
  return `<line ${ends} stroke="${color}" stroke-width="2"${pattern}/>`;
}

const dot = (p: Pt, color: string) => `<circle cx="${r2(p.x)}" cy="${r2(p.y)}" r="4" fill="${color}"/>`;

function arrow(a: Pt, b: Pt, color: string): string {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = (turn: number) => ({ x: b.x - 10 * Math.cos(angle + turn), y: b.y - 10 * Math.sin(angle + turn) });
  const [h1, h2] = [head(0.45), head(-0.45)];
  return `${line(a, b, color)}<path d="M${r2(b.x)} ${r2(b.y)}L${r2(h1.x)} ${r2(h1.y)}L${r2(h2.x)} ${r2(h2.y)}Z" fill="${color}"/>`;
}

function northArrow(): string {
  return `${arrow({ x: SIZE - 18, y: 40 }, { x: SIZE - 18, y: 12 }, PAPER.muted)}${svgText(SIZE - 22, 54, 'N', 11)}`;
}

/** Two points, the lines along their azimuths, and the crossing, with labels for each. */
export function intersectionSvg(p1: Pt, p2: Pt, cross: Pt, labels: [string, string, string], title: string): string {
  const map = frame([p1, p2, cross]);
  const [a, b, x] = [map(p1), map(p2), map(cross)];
  const body =
    line(a, x, PAPER.accent) +
    line(b, x, PAPER.warm) +
    dot(a, PAPER.accent) +
    dot(b, PAPER.warm) +
    dot(x, PAPER.text) +
    svgText(a.x + 6, a.y - 6, labels[0]) +
    svgText(b.x + 6, b.y - 6, labels[1]) +
    svgText(x.x + 6, x.y - 6, labels[2]) +
    northArrow();
  return svgDocument(SIZE, SIZE, body, title);
}

/** The water vector, then the current from its tip, and the ground vector that closes the triangle. */
export function currentSvg(heading: number, speed: number, set: number, drift: number, title: string): string {
  const rad = Math.PI / 180;
  const o = { x: 0, y: 0 };
  const w = { x: speed * Math.sin(heading * rad), y: speed * Math.cos(heading * rad) };
  const g = { x: w.x + drift * Math.sin(set * rad), y: w.y + drift * Math.cos(set * rad) };
  const map = frame([o, w, g]);
  const [mo, mw, mg] = [map(o), map(w), map(g)];
  const body =
    arrow(mo, mw, PAPER.accent) +
    arrow(mw, mg, PAPER.warm) +
    line(mo, mg, PAPER.text, '6 4') +
    dot(mo, PAPER.text) +
    northArrow();
  return svgDocument(SIZE, SIZE, body, title);
}
