// Formulas of rules that run on the engine (DESIGN 13.5). The built-in reader (formula.ts) is fast for the forms
// rules use most. Any formula it cannot read, such as one that calls WEEKDAY, VLOOKUP, or SUMPRODUCT, is compiled by
// the engine instead: parsed with its parser, shifted from the rule's anchor cell to the asked cell, and run on the
// table's values with the engine's own functions.

import type { Node } from '../../../../core/expr';
import { compile, newCtx } from '../../engine/formula/compile';
import { parseFormula } from '../../engine/formula/parser';
import { DEFAULT_ENV } from '../../engine/recalc';
import { ERROR_TOKENS, errorFromToken, isError, type Value } from '../../engine/values';
import { own } from '../model/json';
import { simpleEvaluator, type FormulaContext, type FormulaEvaluator } from './formula';
import { BLANK, valueOfCell, type CellValue } from './value';

interface Kept {
  rows: unknown;
  values: unknown;
  stamp: unknown;
  cols: Value[][];
  compiled: Map<string, ReturnType<typeof compile> | null>;
}
const kept = new WeakMap<object, Kept>();
const MAX_COMPILED = 512;

function toValue(v: CellValue): Value {
  switch (v.kind) {
    case 'num':
      return v.n;
    case 'text':
      return v.s;
    case 'bool':
      return v.b;
    case 'error':
      return errorFromToken(v.e) ?? errorFromToken('#VALUE!');
    default:
      return null;
  }
}

function keptFor(ctx: FormulaContext): Kept {
  const values = own(ctx.sheet, 'values');
  const stamp = own(ctx.sheet, 'valuesOf');
  const known = kept.get(ctx.table);
  if (known && known.rows === ctx.table.rows && known.values === values && known.stamp === stamp) return known;
  const cols: Value[][] = ctx.table.columns.map((_, c) =>
    ctx.table.rows.map((_r, r) => toValue(valueOfCell(ctx.sheet, ctx.table, r, c))),
  );
  const fresh: Kept = { rows: ctx.table.rows, values, stamp, cols, compiled: new Map() };
  kept.set(ctx.table, fresh);
  return fresh;
}

/** A copy of the tree with every relative cell and range moved by the offset. Whole columns and rows stay. */
function shifted(node: Node, dr: number, dc: number): Node {
  if (node.type === 'cell') {
    return {
      ...node,
      col: node.abs?.col ? node.col : Math.max(0, node.col + dc),
      row: node.abs?.row ? node.row : Math.max(0, node.row + dr),
    };
  }
  if (node.type === 'range') {
    const [a, b] = node.abs ?? [
      { col: false, row: false },
      { col: false, row: false },
    ];
    const wholeCol = node.row2 === Infinity;
    const wholeRow = node.col2 === Infinity;
    return {
      ...node,
      col1: a.col || wholeRow ? node.col1 : Math.max(0, node.col1 + dc),
      row1: a.row || wholeCol ? node.row1 : Math.max(0, node.row1 + dr),
      col2: b.col || wholeRow ? node.col2 : Math.max(0, node.col2 + dc),
      row2: b.row || wholeCol ? node.row2 : Math.max(0, node.row2 + dr),
    };
  }
  const out: Record<string, unknown> = { ...node };
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) out[key] = value.map((x) => (isNode(x) ? shifted(x, dr, dc) : x));
    else if (isNode(value)) out[key] = shifted(value, dr, dc);
  }
  return out as unknown as Node;
}

const isNode = (x: unknown): x is Node =>
  typeof x === 'object' && x !== null && typeof (x as { type?: unknown }).type === 'string';

function toCell(v: Value): CellValue {
  if (isError(v)) return { kind: 'error', e: ERROR_TOKENS[v.error] };
  if (typeof v === 'number') return Number.isFinite(v) ? { kind: 'num', n: v } : { kind: 'error', e: '#NUM!' };
  if (typeof v === 'boolean') return { kind: 'bool', b: v };
  if (typeof v === 'string') return v === '' ? BLANK : { kind: 'text', s: v };
  if (v !== null && typeof v === 'object' && 'data' in v) return toCell((v.data[0] ?? null) as Value);
  return BLANK;
}

/** Runs one formula on the engine; an error value when it does not read or run. */
export const engineEvaluator: FormulaEvaluator = (formula, fctx) => {
  const state = keptFor(fctx);
  const dr = fctx.at.row - fctx.anchor.row;
  const dc = fctx.at.col - fctx.anchor.col;
  const key = `${formula}|${dr}|${dc}`;
  let fn = state.compiled.get(key);
  if (fn === undefined) {
    const parsed = parseFormula(formula);
    fn = null;
    if (parsed.ok) {
      const scope = {
        columns: fctx.table.columns.map((col) => ({ id: col.id, name: col.id })),
        rowCount: fctx.table.rows.length,
        env: DEFAULT_ENV,
      };
      fn = compile(shifted(parsed.node, dr, dc), scope, { col: fctx.at.col, row: fctx.at.row });
    }
    if (state.compiled.size >= MAX_COMPILED) state.compiled.clear();
    state.compiled.set(key, fn);
  }
  if (!fn) return { kind: 'error', e: '#NAME?' };
  const ctx = newCtx(state.cols);
  ctx.row = fctx.at.row;
  ctx.col = fctx.at.col;
  return toCell(fn.fn(ctx));
};

/** The simple reader first; the engine for what it cannot read, so no engine function gives #NAME? to a rule. */
export const hybridEvaluator: FormulaEvaluator = (formula, ctx) => {
  const quick = simpleEvaluator(formula, ctx);
  if (quick.kind === 'error' && quick.e === '#NAME?') {
    try {
      return engineEvaluator(formula, ctx);
    } catch {
      return quick;
    }
  }
  return quick;
};
