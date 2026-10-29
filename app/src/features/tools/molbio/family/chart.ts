// Laying out and drawing family charts. People go in rows by generation (married-in partners join their partner's
// row); founders' couples sit side by side, each sibship stays together in birth order with each person's married-in
// partner beside them, and sibships are ordered under their parents. Symbols follow the published NSGC pedigree
// recommendations: squares for males, circles for females, diamonds when sex is not given, filled when affected, a dot
// for a carrier, a slash when deceased, an arrow for the proband, brackets for adoption, and a double line between
// related partners.
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

export function layout(family: Family): Layout {
  const gen = generations(family);
  const depth = Math.max(...gen.values());
  const placed = new Set<string>();
  const at = new Map<string, { x: number; y: number }>();
  const rows: string[][] = [];
  let founders: string[][] = [];
  const marriedIn = (p: Person, g: number) =>
    p.partners
      .map((q) => family.byId.get(q)!)
      .filter((q) => !q.father && !q.mother && gen.get(q.id) === g && !placed.has(q.id));
  for (let g = 0; g <= depth; g++) {
    const y = TOP + g * ROW;
    const blocks: { ids: string[]; center: number }[] = [];
    if (g === 0) {
      for (const p of family.people) {
        if (gen.get(p.id) !== 0 || placed.has(p.id)) continue;
        const ids = [p.id];
        placed.add(p.id);
        for (const q of p.partners.map((id) => family.byId.get(id)!)) {
          if (gen.get(q.id) === 0 && !placed.has(q.id)) {
            ids.push(q.id);
            placed.add(q.id);
          }
        }
        blocks.push({ ids, center: -Infinity });
      }
      founders = blocks.map((b) => b.ids);
    } else {
      const sibships = new Map<string, Person[]>();
      for (const p of family.people) {
        if (gen.get(p.id) !== g || (!p.father && !p.mother)) continue;
        const key = `${p.father ?? ''}|${p.mother ?? ''}`;
        sibships.set(key, [...(sibships.get(key) ?? []), p]);
      }
      const groups = [...sibships.values()].map((kids) => {
        const parents = [kids[0]!.father, kids[0]!.mother].filter((x): x is string => x !== null);
        const xs = parents.map((id) => at.get(id)?.x ?? 0);
        return { kids: kids.sort(byBirth), center: xs.reduce((a, b) => a + b, 0) / xs.length };
      });
      groups.sort((a, b) => a.center - b.center);
      for (const group of groups) {
        const ids: string[] = [];
        for (const kid of group.kids) {
          ids.push(kid.id);
          placed.add(kid.id);
          for (const q of marriedIn(kid, g)) {
            ids.push(q.id);
            placed.add(q.id);
          }
        }
        blocks.push({ ids, center: group.center });
      }
      for (const p of family.people) {
        if (gen.get(p.id) === g && !placed.has(p.id)) {
          placed.add(p.id);
          blocks.push({ ids: [p.id], center: Infinity });
        }
      }
    }
    let cursor = LEFT;
    const row: string[] = [];
    for (const block of blocks) {
      // Center the sibship's own members (not their married-in partners) under the parents.
      const sibs = block.ids.filter((id) => {
        const p = family.byId.get(id)!;
        return p.father !== null || p.mother !== null;
      });
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
    rows.push(row);
  }
  // Center each founding couple over its children, keeping the row's order and spacing.
  let cursor = LEFT;
  for (const ids of founders) {
    const kids = family.people.filter((c) => ids.includes(c.father ?? '') || ids.includes(c.mother ?? ''));
    const want =
      kids.length > 0
        ? kids.reduce((s, c) => s + at.get(c.id)!.x, 0) / kids.length - ((ids.length - 1) / 2) * SPACING
        : cursor;
    let x = Math.max(cursor, want);
    for (const id of ids) {
      at.get(id)!.x = x;
      x += SPACING;
    }
    cursor = x;
  }
  const couples: [string, string][] = [];
  const seen = new Set<string>();
  for (const p of family.people) {
    for (const q of p.partners) {
      const key = p.id < q ? `${p.id}|${q}` : `${q}|${p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      couples.push([p.id, q]);
    }
  }
  const lines: Segment[] = [];
  for (const [a, b] of couples) {
    const A = at.get(a)!;
    const B = at.get(b)!;
    const [l, r] = A.x <= B.x ? [A, B] : [B, A];
    lines.push({ x1: l.x + HALF, y1: l.y, x2: r.x - HALF, y2: r.y });
  }
  const sibships = new Map<string, Person[]>();
  for (const p of family.people) {
    if (!p.father && !p.mother) continue;
    const key = `${p.father ?? ''}|${p.mother ?? ''}`;
    sibships.set(key, [...(sibships.get(key) ?? []), p]);
  }
  for (const kids of sibships.values()) {
    const parents = [kids[0]!.father, kids[0]!.mother].filter((x): x is string => x !== null).map((id) => at.get(id)!);
    const mx = parents.reduce((s, p) => s + p.x, 0) / parents.length;
    const py = Math.max(...parents.map((p) => p.y));
    const cy = at.get(kids[0]!.id)!.y;
    const bar = cy - HALF - 22;
    const xs = kids.map((k) => at.get(k.id)!.x);
    lines.push({ x1: mx, y1: parents.length === 2 ? py : py + HALF, x2: mx, y2: bar });
    lines.push({ x1: Math.min(mx, ...xs), y1: bar, x2: Math.max(mx, ...xs), y2: bar });
    const twinned = new Set<string>();
    for (const k of kids) {
      const twin = k.twin ? kids.find((o) => o.id === k.twin) : undefined;
      if (twin && !twinned.has(k.id)) {
        const a = at.get(k.id)!;
        const b = at.get(twin.id)!;
        const apex = (a.x + b.x) / 2;
        lines.push({ x1: apex, y1: bar, x2: a.x, y2: a.y - HALF }, { x1: apex, y1: bar, x2: b.x, y2: b.y - HALF });
        twinned.add(k.id).add(twin.id);
      } else if (!twinned.has(k.id)) {
        const c = at.get(k.id)!;
        lines.push({ x1: c.x, y1: bar, x2: c.x, y2: c.y - HALF });
      }
    }
  }
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
