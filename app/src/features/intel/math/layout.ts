// Where the symbols sit tells what the math means (A1-28): a bar with symbols above and below is a fraction, symbols
// under a root sign are its radicand, a smaller symbol raised after another is an exponent. This turns read symbols
// with their boxes into LaTeX. The steps run from the most enclosing structure to the plainest, and each replaces the
// symbols it used with one node that has the LaTeX of the whole, so structures nest as deep as they are drawn.
import { centerX, centerY, height, union, width } from './geometry';
import type { Box } from './geometry';

export type NodeRole = 'atom' | 'bar' | 'radical' | 'integral' | 'open' | 'close' | 'openSquare' | 'closeSquare';

export interface Node {
  role: NodeRole;
  box: Box;
  /** The LaTeX of the symbol or of the structure this node stands for. */
  latex: string;
}

const inside = (node: Node, area: Box): boolean =>
  centerX(node.box) >= area.x0 &&
  centerX(node.box) <= area.x1 &&
  centerY(node.box) >= area.y0 &&
  centerY(node.box) <= area.y1;

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 1;
}

/** The typical height of a character among the nodes, which sets how far apart things must be to count as apart. */
function unitOf(nodes: readonly Node[]): number {
  const sizes = nodes.filter((n) => n.role === 'atom').map((n) => Math.max(height(n.box), 1));
  return sizes.length ? median(sizes) : median(nodes.map((n) => height(n.box)));
}

const area = (n: Node): number => width(n.box) * height(n.box);

function merge(nodes: Node[], used: ReadonlySet<Node>, made: Node): Node[] {
  return [...nodes.filter((n) => !used.has(n)), made];
}

/** The text of a group of nodes read on their own, as a numerator or the inside of a root. */
function group(nodes: Node[]): string {
  return layout(nodes);
}

function radicals(nodes: Node[]): Node[] {
  let out = nodes;
  const roots = out.filter((n) => n.role === 'radical').sort((a, b) => area(a) - area(b));
  for (const root of roots) {
    if (!out.includes(root)) continue;
    // The roof starts after the small tick at the left, so what lies under it is to the right of that.
    const under: Box = {
      x0: root.box.x0 + 0.2 * width(root.box),
      x1: root.box.x1,
      y0: root.box.y0,
      y1: root.box.y1 + 0.2 * height(root.box),
    };
    const contents = out.filter((n) => n !== root && inside(n, under));
    const unit = unitOf(out);
    // A small symbol at the top left, outside the roof, is the index of the root.
    const index = out.filter(
      (n) =>
        n !== root &&
        !contents.includes(n) &&
        n.role === 'atom' &&
        height(n.box) < 0.7 * height(root.box) &&
        centerY(n.box) < root.box.y0 + 0.55 * height(root.box) &&
        centerX(n.box) >= root.box.x0 - 1.2 * unit &&
        centerX(n.box) <= root.box.x0 + 0.25 * width(root.box),
    );
    const used = new Set<Node>([root, ...contents, ...index]);
    const latex = `\\sqrt${index.length ? `[${group(index)}]` : ''}{${group(contents)}}`;
    out = merge(out, used, { role: 'atom', box: [...used].map((n) => n.box).reduce(union), latex });
  }
  return out;
}

function fractions(nodes: Node[]): Node[] {
  let out = nodes;
  const bars = out.filter((n) => n.role === 'bar').sort((a, b) => width(a.box) - width(b.box));
  for (const bar of bars) {
    if (!out.includes(bar)) continue;
    const unit = unitOf(out);
    const slack = 0.08 * width(bar.box);
    const span = (n: Node) => centerX(n.box) >= bar.box.x0 - slack && centerX(n.box) <= bar.box.x1 + slack;
    const limit = 2.2 * unit;
    const above = out.filter(
      (n) =>
        n !== bar &&
        span(n) &&
        width(n.box) <= 1.15 * width(bar.box) &&
        n.box.y1 <= bar.box.y1 &&
        bar.box.y0 - n.box.y1 < limit &&
        centerY(n.box) < centerY(bar.box),
    );
    const below = out.filter(
      (n) =>
        n !== bar &&
        span(n) &&
        width(n.box) <= 1.15 * width(bar.box) &&
        n.box.y0 >= bar.box.y0 &&
        n.box.y0 - bar.box.y1 < limit &&
        centerY(n.box) > centerY(bar.box),
    );
    // A minus between terms has nothing above and below it; a bar needs both to be a fraction.
    if (above.length === 0 || below.length === 0) continue;
    // The terms of a fraction are narrower than its bar, and the bar reaches past them a little.
    const used = new Set<Node>([bar, ...above, ...below]);
    const latex = `\\frac{${group(above)}}{${group(below)}}`;
    out = merge(out, used, { role: 'atom', box: [...used].map((n) => n.box).reduce(union), latex });
  }
  return out;
}

function integrals(nodes: Node[]): Node[] {
  let out = nodes;
  for (const sign of out.filter((n) => n.role === 'integral')) {
    const unit = unitOf(out);
    const right = out.filter(
      (n) =>
        n !== sign &&
        n.box.x0 >= sign.box.x1 - 0.5 * width(sign.box) &&
        n.box.x0 <= sign.box.x1 + 2.2 * unit &&
        height(n.box) < 0.65 * height(sign.box),
    );
    const top = right.filter((n) => centerY(n.box) < sign.box.y0 + 0.3 * height(sign.box));
    const bottom = right.filter((n) => centerY(n.box) > sign.box.y0 + 0.7 * height(sign.box));
    const used = new Set<Node>([sign, ...top, ...bottom]);
    const low = bottom.length ? `_{${group(bottom)}}` : '';
    const high = top.length ? `^{${group(top)}}` : '';
    out = merge(out, used, {
      role: 'atom',
      box: [...used].map((n) => n.box).reduce(union),
      latex: `\\int${low}${high}`,
    });
  }
  return out;
}

/** Splits positions into rows or columns wherever the gap between neighbors exceeds `gap`. */
function runs(values: number[], gap: number): number[][] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out: number[][] = [];
  order.forEach(([value, index], k) => {
    if (k === 0 || value - order[k - 1][0] > gap) out.push([index]);
    else out[out.length - 1].push(index);
  });
  return out;
}

function matrices(nodes: Node[]): Node[] {
  let out = nodes;
  const opens = out.filter((n) => n.role === 'open' || n.role === 'openSquare');
  for (const open of opens) {
    if (!out.includes(open)) continue;
    const kind = open.role === 'open' ? 'close' : 'closeSquare';
    const tall = height(open.box);
    const close = out
      .filter(
        (n) =>
          n.role === kind &&
          n.box.x0 > open.box.x1 &&
          Math.abs(n.box.y0 - open.box.y0) < 0.3 * tall &&
          Math.abs(n.box.y1 - open.box.y1) < 0.3 * tall,
      )
      .sort((a, b) => a.box.x0 - b.box.x0)[0];
    if (!close) continue;
    const between: Box = { x0: open.box.x1, x1: close.box.x0, y0: open.box.y0, y1: open.box.y1 };
    const cells = out.filter((n) => n !== open && n !== close && inside(n, between));
    const unit = unitOf(cells.length ? cells : out);
    if (cells.length < 2 || tall < 1.6 * unit) {
      // Brackets around a single line are only brackets.
      continue;
    }
    const rowRuns = runs(
      cells.map((n) => centerY(n.box)),
      0.7 * unit,
    );
    // One row of one entry is only a bracket; a row of several entries, a column, or a grid is a matrix.
    if (
      rowRuns.length < 2 &&
      runs(
        cells.map((n) => centerX(n.box)),
        1.6 * unit,
      ).length < 2
    )
      continue;
    const rows = rowRuns
      .map((indexes) => indexes.map((i) => cells[i]).sort((a, b) => a.box.x0 - b.box.x0))
      .sort((a, b) => centerY(a[0].box) - centerY(b[0].box));
    const text = rows
      .map((row) =>
        runs(
          row.map((n) => centerX(n.box)),
          1.6 * unit,
        )
          .map((indexes) => group(indexes.map((i) => row[i])))
          .join(' & '),
      )
      .join(' \\\\ ');
    const name = open.role === 'open' ? 'pmatrix' : 'bmatrix';
    const used = new Set<Node>([open, close, ...cells]);
    out = merge(out, used, {
      role: 'atom',
      box: [...used].map((n) => n.box).reduce(union),
      latex: `\\begin{${name}} ${text} \\end{${name}}`,
    });
  }
  return out;
}

const OPEN: Record<string, string> = { open: '(', close: ')', openSquare: '[', closeSquare: ']' };

function textOf(node: Node): string {
  if (node.role === 'bar') return '-';
  if (node.role === 'atom') return node.latex;
  return OPEN[node.role] ?? '';
}

/** Puts nodes in reading order with exponents and subscripts attached to the symbol they belong to. */
function sequence(nodes: Node[]): string {
  const ordered = [...nodes].sort((a, b) => a.box.x0 - b.box.x0);
  let out = '';
  let base: Node | null = null;
  let script: { kind: '^' | '_'; box: Box; text: string } | null = null;
  const closeScript = () => {
    if (script) out += `${script.kind}{${script.text}}`;
    script = null;
  };
  for (const node of ordered) {
    if (base) {
      const h = Math.max(height(base.box), 1);
      const smaller = height(node.box) <= 0.85 * h || node.role === 'bar';
      const near = node.box.x0 - base.box.x1 < 1.1 * h;
      const up = near && smaller && centerY(node.box) < centerY(base.box) - 0.25 * h;
      const down = near && smaller && centerY(node.box) > centerY(base.box) + 0.3 * h;
      const current = script;
      if (current && node.box.x0 - current.box.x1 < 1.1 * Math.max(height(current.box), 1)) {
        const same =
          Math.abs(centerY(node.box) - centerY(current.box)) < 0.6 * Math.max(height(current.box), height(node.box));
        if (same) {
          current.text += textOf(node);
          current.box = union(current.box, node.box);
          continue;
        }
      }
      if (up || down) {
        closeScript();
        script = { kind: up ? '^' : '_', box: node.box, text: textOf(node) };
        continue;
      }
    }
    closeScript();
    out += `${out && /[a-z]$/i.test(out) && /^\\/.test(textOf(node)) ? ' ' : ''}${textOf(node)}`;
    base = node;
  }
  closeScript();
  return out.replace(/(\\[a-zA-Z]+) (?=[^a-zA-Z\\])/g, '$1 ').trim();
}

/** The LaTeX of a set of read symbols. */
export function layout(nodes: Node[]): string {
  if (nodes.length === 0) return '';
  return sequence(matrices(integrals(fractions(radicals(nodes)))));
}
