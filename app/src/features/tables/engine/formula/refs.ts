// Compiles references (ADR 0062). It reads A1 cells, ranges, whole columns, whole rows, [Col], structured references
// such as Sales[Amount] or [@Qty], Sales!B2 in another table, A1# spills, and the reference operators. A fixed
// reference is registered as a read when compiled; a spill or a this-row reference is found while running.

import type { Node } from '../../../../core/expr';
import { err, isArray, toScalar, type FormulaError } from '../values';
import { makeArray } from '../arrays';
import type { Box } from '../graph';
import { constant, intersect, isBad, type Fn, type Host, type RefPart, type RefResult } from './context';

type Struct = Extract<Node, { type: 'struct' }>;

/** A reference fixed when compiling, registered as a read. */
export function fixed(h: Host, box: RefResult): RefPart {
  if (!isBad(box)) for (const b of Array.isArray(box) ? box : [box]) h.read(b);
  return { fn: () => box, fixed: box };
}

/** The node as a reference. Nodes that are not references give #VALUE!. */
export function compileRef(h: Host, node: Node): RefPart {
  const s = h.sheet;
  const info = h.book[s];
  switch (node.type) {
    case 'cell':
      if (node.col >= info.columns.length || node.row >= info.rowCount) return fixed(h, err('REF'));
      return fixed(h, { s, r1: node.row, c1: node.col, r2: node.row, c2: node.col });
    case 'range': {
      const c2 = node.col2 === Infinity ? info.columns.length - 1 : node.col2;
      const r2 = Math.min(node.row2, info.rowCount - 1);
      if (c2 >= info.columns.length || node.row1 > r2 || node.col1 > c2) return fixed(h, err('REF'));
      return fixed(h, { s, r1: node.row1, c1: node.col1, r2, c2 });
    }
    case 'col': {
      const i = h.columnIndex(s, node.by, node.key);
      if (i < 0 || info.rowCount === 0) return fixed(h, err('REF'));
      return fixed(h, { s, r1: 0, c1: i, r2: info.rowCount - 1, c2: i });
    }
    case 'struct':
      return structRef(h, node);
    case 'qualified': {
      const target = h.sheetNamed(node.scope);
      if (target < 0) return fixed(h, err('REF'));
      const saved = h.sheet;
      h.sheet = target;
      try {
        return h.refOrNull(node.ref) ?? fixed(h, err('REF'));
      } finally {
        h.sheet = saved;
      }
    }
    case 'spill':
      return spillRef(h, node);
    case 'refop':
      return refOp(h, node);
    default:
      return h.refOrNull(node) ?? fixed(h, err('VALUE'));
  }
}

/** The first and last column a structured reference names, or null when one is unknown. */
export function structColumns(h: Host, s: number, node: Struct): [number, number] | null {
  const count = h.book[s].columns.length;
  if (node.col1 === undefined) return count === 0 ? null : [0, count - 1];
  const a = h.columnIndex(s, 'name', node.col1);
  const b = node.col2 === undefined ? a : h.columnIndex(s, 'name', node.col2);
  if (a < 0 || b < 0) return null;
  return [Math.min(a, b), Math.max(a, b)];
}

/** The table a structured reference names: its own when it names none. -1 when unknown. */
export function structSheet(h: Host, node: Struct): number {
  return node.table === undefined ? h.sheet : h.sheetNamed(node.table);
}

function structRef(h: Host, node: Struct): RefPart {
  const s = structSheet(h, node);
  if (s < 0) return fixed(h, err('REF'));
  const cols = structColumns(h, s, node);
  const rows = h.book[s].rowCount;
  if (cols === null || node.items.includes('#Totals') || node.items.includes('#Headers')) return fixed(h, err('REF'));
  if (!node.thisRow) {
    if (rows === 0) return fixed(h, err('REF'));
    return fixed(h, { s, r1: 0, c1: cols[0], r2: rows - 1, c2: cols[1] });
  }
  const row = h.owner.row;
  if (row !== null) {
    if (row >= rows) return fixed(h, err('REF'));
    return fixed(h, { s, r1: row, c1: cols[0], r2: row, c2: cols[1] });
  }
  h.read({ s, r1: 0, c1: cols[0], r2: Infinity, c2: cols[1] });
  return { fn: (ctx) => (ctx.row < rows ? { s, r1: ctx.row, c1: cols[0], r2: ctx.row, c2: cols[1] } : err('REF')) };
}

function spillRef(h: Host, node: Extract<Node, { type: 'spill' }>): RefPart {
  let s = h.sheet;
  let target = node.ref;
  if (target.type === 'qualified') {
    s = h.sheetNamed(target.scope);
    target = target.ref;
  }
  if (s < 0 || target.type !== 'cell') return fixed(h, err('REF'));
  const { col, row } = target;
  if (col >= h.book[s].columns.length || row >= h.book[s].rowCount) return fixed(h, err('REF'));
  // Reading the anchor orders this formula after it; the anchor's results are its outputs.
  h.read({ s, r1: row, c1: col, r2: row, c2: col });
  return { fn: (ctx) => ctx.rt.spillBox(s, col, row) };
}

function refOp(h: Host, node: Extract<Node, { type: 'refop' }>): RefPart {
  const left = compileRef(h, node.left);
  const right = compileRef(h, node.right);
  if (node.op === ',') {
    return {
      fn: (ctx) => {
        const a = left.fn(ctx);
        const b = right.fn(ctx);
        if (isBad(a)) return a;
        if (isBad(b)) return b;
        return [...(Array.isArray(a) ? a : [a]), ...(Array.isArray(b) ? b : [b])];
      },
    };
  }
  return {
    fn: (ctx): Box | FormulaError => {
      const a = left.fn(ctx);
      const b = right.fn(ctx);
      if (isBad(a)) return a;
      if (isBad(b)) return b;
      if (Array.isArray(a) || Array.isArray(b)) return err('VALUE');
      return intersect(a, b);
    },
  };
}

/** Table[[#Headers],[Col]]: the column names, as text. */
export function headers(h: Host, node: Struct): Fn {
  const s = structSheet(h, node);
  const cols = s < 0 ? null : structColumns(h, s, node);
  if (cols === null) return constant(err('REF'));
  const names = h.book[s].columns.slice(cols[0], cols[1] + 1).map((c) => c.name);
  return constant(names.length === 1 ? names[0] : makeArray(1, names.length, names));
}

/** [@Col] or Table[@Col]: the value on the formula's own row. */
export function thisRowValue(h: Host, node: Struct): Fn {
  const s = structSheet(h, node);
  const cols = s < 0 ? null : structColumns(h, s, node);
  if (cols === null) return constant(err('REF'));
  if (cols[0] !== cols[1]) return h.deref(compileRef(h, node));
  const col = cols[0];
  const row = h.owner.row;
  if (row !== null) return h.cellValue(s, col, row);
  h.read({ s, r1: 0, c1: col, r2: Infinity, c2: col });
  return (ctx) => toScalar(ctx.sheets[s][col][ctx.row] ?? err('REF'));
}

/** @: one value from a block, on the formula's own row or column. */
export function implicit(h: Host, arg: Node): Fn {
  const ref = h.refOrNull(arg);
  if (ref === null) {
    const a = h.value(arg);
    return (ctx) => {
      const v = a(ctx);
      return isArray(v) ? (v.data[0] ?? null) : v;
    };
  }
  return (ctx) => {
    const box = ref.fn(ctx);
    if (isBad(box)) return box;
    if (Array.isArray(box)) return err('VALUE');
    const cols = ctx.sheets[box.s];
    if (box.r1 === box.r2 && box.c1 === box.c2) return toScalar(cols[box.c1][box.r1]);
    if (box.c1 === box.c2 && ctx.row >= box.r1 && ctx.row <= box.r2) return toScalar(cols[box.c1][ctx.row]);
    if (box.r1 === box.r2 && ctx.col >= box.c1 && ctx.col <= box.c2) return toScalar(cols[ctx.col][box.r1]);
    return err('VALUE');
  };
}
