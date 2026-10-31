// Laying out and drawing family charts. People go in rows by generation, and married-in partners join their
// partner's row. Founding couples sit side by side, and each sibship stays together in birth order under its parents.
// Symbols follow the published NSGC pedigree recommendations. Squares are males, circles females, and diamonds people
// of unstated sex. A filled symbol is affected, a dot marks a carrier, and a slash a deceased person. An arrow marks
// the proband, brackets an adoption, and a double line related partners.
import type { Figure, Shape } from '../figure';
import { depthOf, kinship } from './kin';
import { byBirth } from './people';
import type { Family, Person } from './people';

export const SPACING = 64;
export const ROW = 110;
export const HALF = 12;
const LEFT = 56;
const TOP = 30;

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Layout {
  rows: string[][];
  at: Map<string, { x: number; y: number }>;
  generation: Map<string, number>;
  /** Partner, descent, sibship, and child lines, for drawing and for crossing checks. */
  lines: Segment[];
  couples: [string, string][];
}

const roman = (n: number): string => {
  const table: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of table) while (n >= v) [n, out] = [n - v, out + s];
  return out;
};

/** Generations with married-in founders moved to their partner's row and children kept below both parents. */
function generations(family: Family): Map<string, number> {
  const gen = depthOf(family);
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const p of family.people) {
      if (!p.father && !p.mother && p.partners.length > 0) {
        const g = Math.max(...p.partners.map((q) => gen.get(q)!));
        if (g > gen.get(p.id)!) {
          gen.set(p.id, g);
          changed = true;
        }
      }
      const parents = [p.father, p.mother].filter((x): x is string => x !== null);
      if (parents.length > 0) {
        const g = 1 + Math.max(...parents.map((q) => gen.get(q)!));
        if (g > gen.get(p.id)!) {
          gen.set(p.id, g);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return gen;
}

type Block = { ids: string[]; center: number };
type Points = Map<string, { x: number; y: number }>;

const sibshipKey = (p: Person): string => `${p.father ?? ''}|${p.mother ?? ''}`;

/** People with parents grouped by their parents, in list order. */
function sibshipsOf(people: readonly Person[]): Person[][] {
  const groups = new Map<string, Person[]>();
  for (const p of people) {
    if (!p.father && !p.mother) continue;
    groups.set(sibshipKey(p), [...(groups.get(sibshipKey(p)) ?? []), p]);
  }
  return [...groups.values()];
}

const parentIds = (p: Person): string[] => [p.father, p.mother].filter((x): x is string => x !== null);

/** The founders' row: each founder followed by their founding partners. */
function founderBlocks(family: Family, gen: Map<string, number>, placed: Set<string>): Block[] {
  const blocks: Block[] = [];
  for (const p of family.people) {
    if (gen.get(p.id) !== 0 || placed.has(p.id)) continue;
    const ids = [p.id, ...p.partners.filter((q) => gen.get(q) === 0 && !placed.has(q))];
    ids.forEach((id) => placed.add(id));
    blocks.push({ ids, center: -Infinity });
  }
  return blocks;
}

/** A later row: sibships under their parents in birth order, each person followed by married-in partners. */
function rowBlocks(family: Family, gen: Map<string, number>, g: number, placed: Set<string>, at: Points): Block[] {
  const groups = sibshipsOf(family.people.filter((p) => gen.get(p.id) === g)).map((kids) => {
    const xs = parentIds(kids[0]!).map((id) => at.get(id)?.x ?? 0);
    return { kids: kids.sort(byBirth), center: xs.reduce((a, b) => a + b, 0) / xs.length };
  });
  groups.sort((a, b) => a.center - b.center);
  const blocks: Block[] = groups.map((group) => {
    const ids: string[] = [];
    for (const kid of group.kids) {
      const partners = kid.partners
        .map((q) => family.byId.get(q)!)
        .filter((q) => !q.father && !q.mother && gen.get(q.id) === g && !placed.has(q.id));
      for (const id of [kid.id, ...partners.map((q) => q.id)]) {
        ids.push(id);
        placed.add(id);
      }
    }
    return { ids, center: group.center };
  });
  for (const p of family.people) {
    if (gen.get(p.id) !== g || placed.has(p.id)) continue;
    placed.add(p.id);
    blocks.push({ ids: [p.id], center: Infinity });
  }
  return blocks;
}

/** Places a row left to right, centering each sibship's own members (not married-in partners) under its parents. */
function placeRow(family: Family, blocks: readonly Block[], y: number, at: Points): string[] {
  let cursor = LEFT;
  const row: string[] = [];
  for (const block of blocks) {
    const sibs = block.ids.filter((id) => parentIds(family.byId.get(id)!).length > 0);
    const first = block.ids.indexOf(sibs[0] ?? block.ids[0]!);
    const last = block.ids.indexOf(sibs.at(-1) ?? block.ids[0]!);
    const want = Number.isFinite(block.center) ? block.center - ((first + last) / 2) * SPACING : cursor;
    let x = Math.max(cursor, want);
    for (const id of block.ids) {
      at.set(id, { x, y });
      row.push(id);
      x += SPACING;
    }
    cursor = x;
  }
  return row;
}

/** Moves each founding couple over its children while keeping the row in order with its spacing. */
function centerFounders(family: Family, founders: readonly string[][], at: Points): void {
  let cursor = LEFT;
  for (const ids of founders) {
    const kids = family.people.filter((c) => ids.includes(c.father ?? '') || ids.includes(c.mother ?? ''));
    const mean = kids.reduce((s, c) => s + at.get(c.id)!.x, 0) / (kids.length || 1);
    const want = kids.length > 0 ? mean - ((ids.length - 1) / 2) * SPACING : cursor;
    let x = Math.max(cursor, want);
    for (const id of ids) {
      at.get(id)!.x = x;
      x += SPACING;
    }
    cursor = x;
  }
}

function couplesOf(family: Family): [string, string][] {
  const couples: [string, string][] = [];
  const seen = new Set<string>();
  for (const p of family.people) {
    for (const q of p.partners) {
      const key = p.id < q ? `${p.id}|${q}` : `${q}|${p.id}`;
      if (!seen.has(key)) couples.push([p.id, q]);
      seen.add(key);
    }
  }
  return couples;
}

/** The descent line, the sibship bar, and a line to each child (twins share one point on the bar). */
function descentLines(kids: readonly Person[], at: Points): Segment[] {
  const parents = parentIds(kids[0]!).map((id) => at.get(id)!);
  const mx = parents.reduce((s, p) => s + p.x, 0) / parents.length;
  const py = Math.max(...parents.map((p) => p.y));
  const bar = at.get(kids[0]!.id)!.y - HALF - 22;
  const xs = kids.map((k) => at.get(k.id)!.x);
  const lines: Segment[] = [
    { x1: mx, y1: parents.length === 2 ? py : py + HALF, x2: mx, y2: bar },
    { x1: Math.min(mx, ...xs), y1: bar, x2: Math.max(mx, ...xs), y2: bar },
  ];
  const twinned = new Set<string>();
  for (const k of kids) {
    if (twinned.has(k.id)) continue;
    const twin = k.twin ? kids.find((o) => o.id === k.twin) : undefined;
    const pair = twin ? [k, twin] : [k];
    const apex = pair.reduce((s, p) => s + at.get(p.id)!.x, 0) / pair.length;
    for (const p of pair) {
      const c = at.get(p.id)!;
      lines.push({ x1: apex, y1: bar, x2: c.x, y2: c.y - HALF });
      twinned.add(p.id);
    }
  }
  return lines;
}

export function layout(family: Family): Layout {
  const gen = generations(family);
  const depth = Math.max(...gen.values());
  const placed = new Set<string>();
  const at: Points = new Map();
  const rows: string[][] = [];
  const founders = founderBlocks(family, gen, placed);
  rows.push(placeRow(family, founders, TOP, at));
  for (let g = 1; g <= depth; g++)
    rows.push(placeRow(family, rowBlocks(family, gen, g, placed, at), TOP + g * ROW, at));
  centerFounders(
    family,
    founders.map((b) => b.ids),
    at,
  );
  const couples = couplesOf(family);
  const lines: Segment[] = couples.map(([a, b]) => {
    const [l, r] = [at.get(a)!, at.get(b)!].sort((p, q) => p.x - q.x) as [
      { x: number; y: number },
      { x: number; y: number },
    ];
    return { x1: l.x + HALF, y1: l.y, x2: r.x - HALF, y2: r.y };
  });
  for (const kids of sibshipsOf(family.people)) lines.push(...descentLines(kids, at));
  return { rows, at, generation: gen, lines, couples };
}

/** Proper crossings between two segments, ignoring shared ends and touching. */
export function crosses(a: Segment, b: Segment): boolean {
  const d = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const A: [number, number] = [a.x1, a.y1];
  const B: [number, number] = [a.x2, a.y2];
  const C: [number, number] = [b.x1, b.y1];
  const D: [number, number] = [b.x2, b.y2];
  const d1 = d(C, D, A);
  const d2 = d(C, D, B);
  const d3 = d(A, B, C);
  const d4 = d(A, B, D);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

export interface ChartOptions {
  /** Words under each person, such as a kin type or a genotype probability. */
  extra?: Map<string, string>;
  /** People drawn with a heavier outline, such as Ego. */
  highlight?: Set<string>;
  relations?: { a: string; b: string; kind: 'close' | 'distant' | 'conflict' | 'cutoff' }[];
  households?: string[][];
}

function symbol(p: Person, x: number, y: number, strong: boolean): Shape[] {
  const fill = p.affected ? 'ink' : 'paper';
  const width = strong ? 3 : 1.5;
  const out: Shape[] = [];
  if (p.sex === 'M')
    out.push({ kind: 'rect', x: x - HALF, y: y - HALF, w: 2 * HALF, h: 2 * HALF, stroke: 'ink', fill, width });
  else if (p.sex === 'F') out.push({ kind: 'circle', cx: x, cy: y, r: HALF, stroke: 'ink', fill, width });
  else
    out.push({
      kind: 'path',
      d: `M${x} ${y - HALF - 2}L${x + HALF + 2} ${y}L${x} ${y + HALF + 2}L${x - HALF - 2} ${y}Z`,
      stroke: 'ink',
      fill,
      width,
    });
  if (p.carrier && !p.affected) out.push({ kind: 'circle', cx: x, cy: y, r: 3.5, stroke: 'none', fill: 'ink' });
  if (p.unknown) out.push({ kind: 'text', x, y: y + 4, label: '?', size: 12, anchor: 'middle' });
  if (p.deceased)
    out.push({
      kind: 'line',
      x1: x - HALF - 6,
      y1: y + HALF + 6,
      x2: x + HALF + 6,
      y2: y - HALF - 6,
      stroke: 'ink',
      width: 1.5,
    });
  if (p.adopted) {
    out.push({ kind: 'path', d: `M${x - HALF - 4} ${y - HALF - 4}h-4v${2 * HALF + 8}h4`, stroke: 'ink', width: 1.2 });
    out.push({ kind: 'path', d: `M${x + HALF + 4} ${y - HALF - 4}h4v${2 * HALF + 8}h-4`, stroke: 'ink', width: 1.2 });
  }
  if (p.proband) {
    out.push({
      kind: 'line',
      x1: x - HALF - 18,
      y1: y + HALF + 14,
      x2: x - HALF - 3,
      y2: y + HALF - 1,
      stroke: 'accent',
      width: 2,
    });
    out.push({
      kind: 'path',
      d: `M${x - HALF - 3} ${y + HALF - 1}l-8 1l3 3z`,
      stroke: 'accent',
      fill: 'accent',
      width: 1,
    });
  }
  return out;
}

export function chartFigure(family: Family, options: ChartOptions = {}): { figure: Figure; layout: Layout } {
  const plan = layout(family);
  const phi = kinship(family);
  const shapes: Shape[] = [];
  for (const house of options.households ?? []) {
    const pts = house.map((id) => plan.at.get(id)!).filter(Boolean);
    if (pts.length === 0) continue;
    const x1 = Math.min(...pts.map((p) => p.x)) - HALF - 14;
    const x2 = Math.max(...pts.map((p) => p.x)) + HALF + 14;
    const y1 = Math.min(...pts.map((p) => p.y)) - HALF - 12;
    const y2 = Math.max(...pts.map((p) => p.y)) + HALF + 30;
    shapes.push({
      kind: 'rect',
      x: x1,
      y: y1,
      w: x2 - x1,
      h: y2 - y1,
      r: 10,
      stroke: 'muted',
      dash: '5 4',
      width: 1.2,
    });
  }
  for (const s of plan.lines) shapes.push({ kind: 'line', ...s, stroke: 'ink', width: 1.5 });
  for (const [a, b] of plan.couples) {
    if (phi(a, b) > 0) {
      const A = plan.at.get(a)!;
      const B = plan.at.get(b)!;
      const [l, r] = A.x <= B.x ? [A, B] : [B, A];
      shapes.push({
        kind: 'line',
        x1: l.x + HALF,
        y1: l.y + 4,
        x2: r.x - HALF,
        y2: r.y + 4,
        stroke: 'ink',
        width: 1.5,
      });
    }
  }
  for (const rel of options.relations ?? []) {
    const A = plan.at.get(rel.a)!;
    const B = plan.at.get(rel.b)!;
    const mx = (A.x + B.x) / 2;
    const my = Math.max(A.y, B.y) + 44;
    const curve = (dy: number) => `M${A.x} ${A.y + HALF + dy}Q${mx} ${my + dy} ${B.x} ${B.y + HALF + dy}`;
    if (rel.kind === 'close') {
      shapes.push(
        { kind: 'path', d: curve(0), stroke: 'accent', width: 1.5 },
        { kind: 'path', d: curve(4), stroke: 'accent', width: 1.5 },
      );
    } else if (rel.kind === 'distant') {
      shapes.push({ kind: 'path', d: curve(0), stroke: 'accent', width: 1.5, dash: '4 4' });
    } else if (rel.kind === 'conflict') {
      const n = 10;
      let d = `M${A.x} ${A.y + HALF}`;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const x = (1 - t) * (1 - t) * A.x + 2 * (1 - t) * t * mx + t * t * B.x;
        const y =
          (1 - t) * (1 - t) * (A.y + HALF) + 2 * (1 - t) * t * my + t * t * (B.y + HALF) + (k % 2 === 0 ? -5 : 5);
        d += `L${x} ${y}`;
      }
      shapes.push({ kind: 'path', d, stroke: 'accent', width: 1.5 });
    } else {
      const cy = (A.y + B.y + 2 * HALF) / 4 + my / 2;
      shapes.push(
        { kind: 'path', d: curve(0), stroke: 'accent', width: 1.5 },
        { kind: 'line', x1: mx - 4, y1: cy - 8, x2: mx - 4, y2: cy + 8, stroke: 'accent', width: 2 },
        { kind: 'line', x1: mx + 4, y1: cy - 8, x2: mx + 4, y2: cy + 8, stroke: 'accent', width: 2 },
      );
    }
  }
  plan.rows.forEach((row, g) => {
    shapes.push({
      kind: 'text',
      x: 14,
      y: TOP + g * ROW + 4,
      label: roman(g + 1),
      size: 13,
      bold: true,
      tone: 'muted',
    });
    row.forEach((id, k) => {
      const p = family.byId.get(id)!;
      const { x, y } = plan.at.get(id)!;
      shapes.push(...symbol(p, x, y, options.highlight?.has(id) ?? false));
      shapes.push({
        kind: 'text',
        x,
        y: y + HALF + 14,
        label: `${roman(g + 1)}-${k + 1}`,
        size: 9,
        anchor: 'middle',
        tone: 'muted',
      });
      const words = [p.id === p.label || p.label === '' ? p.id : `${p.id} ${p.label}`, options.extra?.get(id)].filter(
        Boolean,
      );
      words.forEach((w, i) =>
        shapes.push({ kind: 'text', x, y: y + HALF + 27 + i * 12, label: w!, size: 10, anchor: 'middle' }),
      );
    });
  });
  const xs = [...plan.at.values()].map((p) => p.x);
  const width = Math.max(320, Math.max(...xs) + 70);
  const height = TOP + plan.rows.length * ROW;
  return { figure: { width, height, shapes }, layout: plan };
}

export { roman };
