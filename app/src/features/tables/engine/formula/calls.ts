// How a library function gets its arguments (fn/types.ts, ADR 0060). There are two ways.
// - A function whose parameters are all ranges (SUM, COUNT, AVERAGE) gets one flat list of every cell and value, as
//   before. Cells come as they are. Values typed directly are coerced by the parameter's `direct` rule.
// - Any other function gets each argument by its parameter's kind. A range or array parameter gets an array, or a
//   reference for a function that returns references. A lambda parameter gets the value as it is. Other kinds get
//   one value.
// When a single-value parameter gets an array, the function runs once per item and the result is an array.

import type { Node } from '../../../../core/expr';
import {
  err,
  isArray,
  isError,
  isRef,
  parseCanonicalNumber,
  toScalar,
  reasonOf,
  type RefValue,
  type Scalar,
  type Value,
} from '../values';
import { asArray, mapN } from '../arrays';
import type { Box } from '../graph';
import { isGroup, paramsOf, type FnSpec2, type Param } from './fn';
import type { ArgSummary, ErrorOrigin } from './explain';
import { cellsOf, colKey, constant, isBad, readBox, type Ctx, type Fn, type Host, type RefPart } from './context';

type Call = Extract<Node, { type: 'call' }>;

const SCALAR_KINDS = new Set(['value', 'number', 'text', 'bool']);

/** An argument typed directly in an aggregate counts as a number: TRUE is 1, and other text is an error. */
function direct(value: Scalar, out: Scalar[]): void {
  if (value === null) return;
  if (typeof value === 'boolean') out.push(value ? 1 : 0);
  else if (typeof value === 'string') out.push(parseCanonicalNumber(value) ?? err('VALUE'));
  else out.push(value);
}

function summarize(value: Value): Scalar | ArgSummary {
  if (isArray(value)) return { rows: value.rows, cols: value.cols };
  if (isRef(value)) return { rows: value.r2 - value.r1 + 1, cols: value.c2 - value.c1 + 1 };
  return toScalar(value);
}

/** The parameter each argument fills, with repeating groups repeated. */
function paramsFor(spec: FnSpec2, count: number): Param[] {
  const groupAt = spec.params.findIndex(isGroup);
  if (groupAt < 0) return spec.params as Param[];
  const before = spec.params.slice(0, groupAt) as Param[];
  const after = spec.params.slice(groupAt + 1).filter((p): p is Param => !isGroup(p));
  const group = spec.params[groupAt] as { repeat: readonly Param[] };
  const out: Param[] = [];
  for (let i = 0; i < count; i++) {
    if (i < before.length) out.push(before[i]);
    else if (i >= count - after.length) out.push(after[i - (count - after.length)]);
    else out.push(group.repeat[(i - before.length) % group.repeat.length]);
  }
  return out;
}

function arityOf(spec: FnSpec2): [number, number] {
  let min = 0;
  let max = 0;
  for (const p of spec.params) {
    if (isGroup(p)) {
      min += (p.min ?? 0) * p.repeat.length;
      max = Infinity;
    } else {
      if (p.optional !== true) min++;
      max++;
    }
  }
  return [min, max];
}

/** A call to a library function. */
export function compileLibrary(h: Host, spec: FnSpec2, node: Call): Fn {
  const [min, max] = arityOf(spec);
  if (node.args.length < min || node.args.length > max) return constant(err('VALUE'));
  if (spec.volatile === true) h.volatile = true;
  const all = paramsOf(spec);
  if (all.length > 0 && all.every((p) => p.kind === 'range')) return aggregate(h, spec, node);
  return plain(h, spec, node);
}

function reasonField(v: Value): { reason?: string } {
  const reason = reasonOf(v);
  return reason === undefined ? {} : { reason };
}

function originOf(spec: FnSpec2, node: Call): ErrorOrigin {
  return { code: 'VALUE', kind: 'function', name: spec.name, start: node.start, end: node.end };
}

function aggregate(h: Host, spec: FnSpec2, node: Call): Fn {
  const env = h.scope.env;
  const params = paramsFor(spec, node.args.length);
  const fixedBoxes: Box[] = [];
  let shareable = spec.volatile !== true;
  const lists = node.args.map((arg, i) => {
    const raw = params[i]?.direct === 'raw';
    const ref = h.refOrNull(arg);
    if (ref !== null) {
      if (ref.fixed === undefined || isBad(ref.fixed)) shareable = false;
      else fixedBoxes.push(...(Array.isArray(ref.fixed) ? ref.fixed : [ref.fixed]));
      return (ctx: Ctx): readonly Value[] => {
        const box = ref.fn(ctx);
        if (isBad(box)) return [box];
        if (!Array.isArray(box)) return cellsOf(ctx, box);
        return box.flatMap((b) => cellsOf(ctx, b));
      };
    }
    shareable = false;
    const part = h.value(arg);
    return (ctx: Ctx): readonly Value[] => {
      const v = part(ctx);
      if (isArray(v)) return v.data;
      const out: Scalar[] = [];
      if (raw) out.push(toScalar(v));
      else direct(toScalar(v), out);
      return out;
    };
  });
  const origin = originOf(spec, node);
  const compute: Fn = (ctx) => {
    const v = spec.run((lists.length === 1 ? lists[0](ctx) : lists.flatMap((list) => list(ctx))) as Value[], env);
    if (ctx.origin === null && isError(v)) ctx.origin = { ...origin, code: v.error, ...reasonField(v) };
    return v;
  };
  if (!shareable) return compute;
  // Aggregates over fixed blocks are shared by every formula that asks within one recalculation.
  const key = `${spec.name}|${fixedBoxes.map((b) => `${b.s},${b.r1},${b.c1},${b.r2},${b.c2}`).join('|')}`;
  const columns: number[] = [];
  for (const box of fixedBoxes) for (let c = box.c1; c <= box.c2; c++) columns.push(colKey(box.s, c));
  return (ctx) => {
    const known = ctx.memo.get(key);
    if (known !== undefined) return known;
    const v = compute(ctx);
    ctx.memo.set(key, v);
    for (const c of columns) ctx.memoCols.add(c);
    return v;
  };
}

/** Runs a function, once per item when a single-value parameter got an array. */
function runLifted(spec: FnSpec2, values: Value[], scalar: boolean[], env: Host['scope']['env']): Value {
  const handles = spec.handlesErrors === true;
  let lifted = false;
  for (let i = 0; i < values.length; i++) {
    if (!scalar[i]) continue;
    const v = values[i];
    if (isArray(v)) lifted = true;
    else if (!handles && isError(v)) return v;
  }
  if (!lifted) return spec.run(values, env);
  const at = values.map((_, i) => i).filter((i) => scalar[i] && isArray(values[i]));
  return mapN(
    at.map((i) => values[i]),
    (items) => {
      const call = [...values];
      at.forEach((index, k) => (call[index] = items[k]));
      if (!handles) for (const index of at) if (isError(call[index])) return call[index];
      return spec.run(call, env);
    },
  );
}

function plain(h: Host, spec: FnSpec2, node: Call): Fn {
  const env = h.scope.env;
  const params = paramsFor(spec, node.args.length);
  const returnsRef = spec.returnsRef === true;
  if (returnsRef) h.dynamic = true;
  const parts: Fn[] = node.args.map((arg, i) => {
    const kind = params[i]?.kind ?? 'value';
    if (kind !== 'range' && kind !== 'array') return h.value(arg);
    const ref = h.refOrNull(arg);
    if (ref !== null && returnsRef && kind === 'range') return (ctx) => toRefValue(h, ref.fn(ctx));
    const v = ref !== null ? h.deref(ref) : h.value(arg);
    return (ctx) => {
      const value = v(ctx);
      return isError(value) ? value : asArray(value);
    };
  });
  // A lazy parameter of a form the engine does not know arrives evaluated, errors included, never broadcast.
  const scalar = params.map((p) => SCALAR_KINDS.has(p?.kind ?? 'value'));
  const origin = originOf(spec, node);
  return (ctx) => {
    const values = parts.map((p) => p(ctx));
    let v = runLifted(spec, values, scalar, env);
    if (isRef(v)) v = readReturned(h, ctx, v);
    if (ctx.origin === null && isError(v) && !values.some((a) => a === v)) {
      ctx.origin = { ...origin, code: v.error, args: values.map(summarize), ...reasonField(v) };
    }
    return v;
  };
}

/** A reference given to a function that returns references. */
function toRefValue(h: Host, box: Box | Box[] | Value): Value {
  if (typeof box !== 'object' || box === null || !('s' in box)) {
    return Array.isArray(box) ? err('VALUE') : (box as Value);
  }
  const table = box.s === h.ownSheet ? undefined : h.book[box.s].name;
  return { kind: 'ref', ...(table === undefined ? {} : { table }), r1: box.r1, c1: box.c1, r2: box.r2, c2: box.c2 };
}

/** The block a function's returned reference names. */
function boxOf(h: Host, ref: RefValue): Box | Value {
  const s = ref.table === undefined ? h.ownSheet : h.sheetNamed(ref.table);
  if (s < 0) return err('REF');
  const info = h.book[s];
  if (ref.r1 < 0 || ref.c1 < 0 || ref.r2 >= info.rowCount || ref.c2 >= info.columns.length) return err('REF');
  if (ref.r1 > ref.r2 || ref.c1 > ref.c2) return err('REF');
  return { s, r1: ref.r1, c1: ref.c1, r2: ref.r2, c2: ref.c2 };
}

const isBox = (v: Box | Value): v is Box => typeof v === 'object' && v !== null && 's' in v;

/** Reads a returned reference, and records it as a read only known while running. */
function readReturned(h: Host, ctx: Ctx, ref: RefValue): Value {
  const box = boxOf(h, ref);
  if (!isBox(box)) return box;
  ctx.dyn?.push(box);
  return readBox(ctx, box);
}

/** A call to a function that returns a reference, used where a reference is wanted. Null for other calls. */
export function compileCallRef(h: Host, spec: FnSpec2 | undefined, node: Call): RefPart | null {
  if (spec?.returnsRef !== true) return null;
  const params = paramsFor(spec, node.args.length);
  h.dynamic = true;
  if (spec.volatile === true) h.volatile = true;
  const parts: Fn[] = node.args.map((arg, i) => {
    const ref = params[i]?.kind === 'range' ? h.refOrNull(arg) : null;
    return ref !== null ? (ctx) => toRefValue(h, ref.fn(ctx)) : h.value(arg);
  });
  const env = h.scope.env;
  return {
    fn: (ctx) => {
      const v = spec.run(
        parts.map((p) => p(ctx)),
        env,
      );
      if (isError(v)) return v;
      if (!isRef(v)) return err('VALUE');
      const box = boxOf(h, v);
      if (!isBox(box)) return isError(box) ? box : err('VALUE');
      ctx.dyn?.push(box);
      return box;
    },
  };
}
