// Turns a laid-out molecule into drawing parts: straight bond lines and atom labels, in skeletal style. Carbon is a
// corner with no letter, heteroatoms and charged atoms get letters with their hydrogens, and bond lines stop short of
// letters. The same parts become ink strokes and text boxes on a page, or an SVG file.
import { layout } from './layout';
import type { Point } from './layout';
import { composition, parseSmiles } from './smiles';
import type { Molecule } from './smiles';

export interface Segment {
  from: Point;
  to: Point;
  /** The bond this line belongs to, by index. */
  bond: number;
}

export interface Label {
  at: Point;
  text: string;
  atom: number;
}

export interface Drawing {
  segments: Segment[];
  labels: Label[];
  /** Bounds in bond lengths. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  formula: Map<string, number>;
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (n: number) => (n === 1 ? '' : String(n).replace(/\d/g, (d) => SUB[Number(d)]));
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const charged = (charge: number) =>
  charge === 0
    ? ''
    : `${Math.abs(charge) === 1 ? '' : String(Math.abs(charge)).replace(/\d/g, (d) => SUP[Number(d)])}${charge > 0 ? '⁺' : '⁻'}`;

/** The text of an atom's label: its symbol, hydrogens (before the symbol when the bonds lie to the right), and charge. */
export function labelText(symbol: string, hydrogens: number, charge: number, hydrogensFirst: boolean): string {
  const h = hydrogens > 0 ? `H${sub(hydrogens)}` : '';
  return hydrogensFirst ? `${h}${symbol}${charged(charge)}` : `${symbol}${h}${charged(charge)}`;
}

const SHORTEN = 0.3;
const GAP = 0.12;

export function draw(molecule: Molecule): Drawing {
  const { positions, rings } = layout(molecule);
  const degree = molecule.atoms.map((a) => molecule.bonds.filter((b) => b.a === a.index || b.b === a.index).length);
  const labeled = molecule.atoms.map((atom) => {
    if (atom.symbol !== 'C') return true;
    return degree[atom.index] === 0 || atom.charge !== 0 || atom.bracket;
  });
  const labels: Label[] = [];
  molecule.atoms.forEach((atom) => {
    if (!labeled[atom.index]) return;
    const here = positions[atom.index];
    const sides = molecule.bonds
      .filter((b) => b.a === atom.index || b.b === atom.index)
      .map((b) => positions[b.a === atom.index ? b.b : b.a].x - here.x);
    const toRight = sides.reduce((s, x) => s + x, 0) > 0.01;
    labels.push({ at: here, atom: atom.index, text: labelText(atom.symbol, atom.hydrogens, atom.charge, toRight) });
  });

  const segments: Segment[] = [];
  molecule.bonds.forEach((bond, index) => {
    const p = positions[bond.a];
    const q = positions[bond.b];
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const ux = (q.x - p.x) / length;
    const uy = (q.y - p.y) / length;
    const start = labeled[bond.a] ? SHORTEN : 0;
    const end = labeled[bond.b] ? SHORTEN : 0;
    const a = { x: p.x + ux * start, y: p.y + uy * start };
    const b = { x: q.x - ux * end, y: q.y - uy * end };
    const nx = -uy;
    const ny = ux;
    const line = (dx: number, dy: number, cut = 0): Segment => ({
      bond: index,
      from: { x: a.x + dx + ux * cut, y: a.y + dy + uy * cut },
      to: { x: b.x + dx - ux * cut, y: b.y + dy - uy * cut },
    });
    if (bond.order === 1) {
      segments.push(line(0, 0));
      return;
    }
    // Which side is a ring's inside, if this bond is in a ring.
    const ring = rings.find((r) => r.includes(bond.a) && r.includes(bond.b) && r.length >= 3);
    if (bond.order === 2 && ring) {
      const cx = ring.reduce((s, i) => s + positions[i].x, 0) / ring.length;
      const cy = ring.reduce((s, i) => s + positions[i].y, 0) / ring.length;
      const inward = ((p.x + q.x) / 2 - cx) * nx + ((p.y + q.y) / 2 - cy) * ny > 0 ? -1 : 1;
      segments.push(line(0, 0), line(nx * GAP * 2 * inward, ny * GAP * 2 * inward, 0.14));
    } else if (bond.order === 2) {
      // Between two atoms with letters or at a chain end the lines straddle the bond; otherwise one line is shifted.
      const straddle = labeled[bond.a] || labeled[bond.b] || degree[bond.a] === 1 || degree[bond.b] === 1;
      if (straddle) segments.push(line(nx * GAP, ny * GAP), line(-nx * GAP, -ny * GAP));
      else segments.push(line(0, 0), line(nx * GAP * 2, ny * GAP * 2, 0.14));
    } else {
      segments.push(line(0, 0), line(nx * GAP * 1.5, ny * GAP * 1.5), line(-nx * GAP * 1.5, -ny * GAP * 1.5));
    }
  });

  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);
  const pad = 0.5;
  return {
    segments,
    labels,
    bounds: {
      minX: Math.min(...xs) - pad,
      maxX: Math.max(...xs) + pad,
      minY: Math.min(...ys) - pad,
      maxY: Math.max(...ys) + pad,
    },
    formula: composition(molecule),
  };
}

export function drawSmiles(
  text: string,
): { ok: true; drawing: Drawing; molecule: Molecule } | { ok: false; reason: string } {
  const parsed = parseSmiles(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  return { ok: true, drawing: draw(parsed.molecule), molecule: parsed.molecule };
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** An SVG picture of the drawing. `bond` is the length of one bond in SVG units. */
export function toSvg(drawing: Drawing, options: { bond?: number; color?: string; title?: string } = {}): string {
  const bond = options.bond ?? 40;
  // checks-disable-next-line brand-consistency: the default ink of a drawn molecule, as black as the printed page
  const color = options.color ?? '#1d1d1f';
  const { minX, minY, maxX, maxY } = drawing.bounds;
  const width = Math.round((maxX - minX) * bond);
  const height = Math.round((maxY - minY) * bond);
  const x = (v: number) => ((v - minX) * bond).toFixed(1);
  const y = (v: number) => ((v - minY) * bond).toFixed(1);
  const lines = drawing.segments
    .map((s) => `<line x1="${x(s.from.x)}" y1="${y(s.from.y)}" x2="${x(s.to.x)}" y2="${y(s.to.y)}"/>`)
    .join('');
  const texts = drawing.labels
    .map(
      (l) =>
        `<text x="${x(l.at.x)}" y="${y(l.at.y)}" text-anchor="middle" dominant-baseline="central">${escapeXml(l.text)}</text>`,
    )
    .join('');
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">${title}` +
    `<g stroke="${color}" stroke-width="${Math.max(1.5, bond / 20)}" stroke-linecap="round" fill="none">${lines}</g>` +
    `<g fill="${color}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(bond * 0.42)}">${texts}</g></svg>`
  );
}
