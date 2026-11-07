// Forms the compiler evaluates itself because their arguments are not plain values: IF and IFERROR run only the
// branch they need, LET binds names, LAMBDA makes a function value, and ISOMITTED asks about one of LAMBDA's parameters.
// The compiler hands each form a host with the pieces it needs (ADR 0059 and 0062 for arrays and names).

import type { Node } from '../../../../core/expr';
import {
  isArray,
  isError,
  isLambda,
  err,
  toBool,
  toScalar,
  type LambdaValue,
  type Scalar,
  type Value,
} from '../values';
import { asArray, makeArray, mapN } from '../arrays';

/** A runtime frame of LET names or LAMBDA parameters. An omitted optional parameter is undefined. */
export interface Frame {
  readonly vals: (Value | undefined)[];
  readonly up: Frame | null;
}

/** What special forms read and change while running. */
export interface SpecialCtx {
  env: Frame | null;
  depth: number;
  origin: unknown;
}

export type SpecialFn<C extends SpecialCtx> = (ctx: C) => Value;

/** The compiler's side of a special form. */
export interface SpecialHost<C extends SpecialCtx> {
  value(node: Node): SpecialFn<C>;
  /** Opens a lexical frame; names added later become visible to nodes compiled after them. */
  pushFrame(): void;
  /** Adds a name to the innermost frame and returns its slot. */
  addName(name: string): number;
  popFrame(): void;
  /** Where a name bound by LET or a parameter of LAMBDA lives: how many frames up, and its slot. */
  local(name: string): { hops: number; slot: number } | null;
}

/** Recursion through LAMBDA stops here with #NUM!, near where Excel stops with a resource error. */
export const MAX_LAMBDA_DEPTH = 1024;

/** The forms the compiler always evaluates itself, whatever the function library says. */
export const ENGINE_FORMS = new Set(['IF', 'IFERROR', 'LET', 'LAMBDA', 'ISOMITTED']);

function frameAt(env: Frame | null, hops: number): Frame | null {
  let frame = env;
  for (let i = 0; i < hops && frame !== null; i++) frame = frame.up;
  return frame;
}

/** Reads a name bound by LET or a parameter of LAMBDA. An omitted parameter reads as empty. */
export function readLocal<C extends SpecialCtx>(hops: number, slot: number): SpecialFn<C> {
  return (ctx) => frameAt(ctx.env, hops)?.vals[slot] ?? null;
}

/** How a parameter of LAMBDA or a name of LET is written: a plain name, or [name] for an optional parameter. */
function paramName(node: Node): { name: string; optional: boolean } | null {
  if (node.type === 'name' && !node.name.startsWith('#')) return { name: node.name.toUpperCase(), optional: false };
  if (node.type === 'col' && node.by === 'name' && /^[A-Za-z_][\w.]*$/.test(node.key.trim())) {
    return { name: node.key.trim().toUpperCase(), optional: true };
  }
  return null;
}

const constant =
  <C extends SpecialCtx>(value: Value): SpecialFn<C> =>
  () =>
    value;

/** Compiles a special form, or returns null when `name` is not one. */
export function compileSpecial<C extends SpecialCtx>(
  name: string,
  args: readonly Node[],
  host: SpecialHost<C>,
): SpecialFn<C> | null {
  switch (name) {
    case 'IF':
      return args.length < 2 || args.length > 3 ? constant(err('VALUE')) : compileIf(args, host);
    case 'IFERROR':
      return args.length !== 2 ? constant(err('VALUE')) : compileIfError(args, host);
    case 'LET':
      return compileLet(args, host);
    case 'LAMBDA':
      return compileLambda(args, host);
    case 'ISOMITTED':
      return compileIsOmitted(args, host);
    default:
      return null;
  }
}

function compileIf<C extends SpecialCtx>(args: readonly Node[], host: SpecialHost<C>): SpecialFn<C> {
  const test = host.value(args[0]);
  const then = host.value(args[1]);
  const otherwise = args[2] ? host.value(args[2]) : constant<C>(false);
  const pick = (cond: Value, a: () => Value, b: () => Value): Value => {
    const scalar = toScalar(cond);
    const truth = isError(scalar) ? scalar : toBool(scalar);
    if (typeof truth !== 'boolean') return truth;
    return truth ? a() : b();
  };
  return (ctx) => {
    const cond = test(ctx);
    if (!isArray(cond))
      return pick(
        cond,
        () => then(ctx),
        () => otherwise(ctx),
      );
    // An array test picks item by item, so both branches run once.
    const a = then(ctx);
    const b = otherwise(ctx);
    return mapN([cond, a, b], ([c, x, y]) =>
      pick(
        c,
        () => x,
        () => y,
      ),
    );
  };
}

function compileIfError<C extends SpecialCtx>(args: readonly Node[], host: SpecialHost<C>): SpecialFn<C> {
  const value = host.value(args[0]);
  const fallback = host.value(args[1]);
  return (ctx) => {
    const v = value(ctx);
    if (isArray(v)) {
      if (!v.data.some((item) => isError(item))) return v;
      const alt = asArray(fallback(ctx));
      const data: Scalar[] = v.data.map((item, i) => (isError(item) ? (alt.data[i] ?? alt.data[0]) : item));
      return makeArray(v.rows, v.cols, data);
    }
    if (!isError(v)) return v;
    // The error was handled, so where it came from no longer explains anything.
    ctx.origin = null;
    return fallback(ctx);
  };
}

function compileLet<C extends SpecialCtx>(args: readonly Node[], host: SpecialHost<C>): SpecialFn<C> {
  if (args.length < 3 || args.length % 2 === 0) return constant(err('VALUE'));
  const names = [];
  for (let i = 0; i < args.length - 1; i += 2) {
    const param = paramName(args[i]);
    if (param === null || param.optional) return constant(err('VALUE'));
    names.push(param.name);
  }
  host.pushFrame();
  const values: SpecialFn<C>[] = [];
  for (let i = 0; i < names.length; i++) {
    values.push(host.value(args[i * 2 + 1]));
    host.addName(names[i]);
  }
  const body = host.value(args[args.length - 1]);
  host.popFrame();
  return (ctx) => {
    const saved = ctx.env;
    const frame: Frame = { vals: new Array(values.length), up: saved };
    ctx.env = frame;
    try {
      for (let i = 0; i < values.length; i++) frame.vals[i] = values[i](ctx);
      return body(ctx);
    } finally {
      ctx.env = saved;
    }
  };
}

function compileLambda<C extends SpecialCtx>(args: readonly Node[], host: SpecialHost<C>): SpecialFn<C> {
  if (args.length < 1) return constant(err('VALUE'));
  const params: { name: string; optional: boolean }[] = [];
  for (const node of args.slice(0, -1)) {
    const param = paramName(node);
    if (param === null || params.some((p) => p.name === param.name)) return constant(err('VALUE'));
    params.push(param);
  }
  // A required parameter may not follow an optional one.
  if (params.some((p, i) => !p.optional && params.slice(0, i).some((q) => q.optional))) return constant(err('VALUE'));
  host.pushFrame();
  for (const param of params) host.addName(param.name);
  const body = host.value(args[args.length - 1]);
  host.popFrame();
  const required = params.filter((p) => !p.optional).length;
  return (ctx) => makeLambda(ctx, params, required, body, ctx.env);
}

function makeLambda<C extends SpecialCtx>(
  ctx: C,
  params: readonly { name: string }[],
  required: number,
  body: SpecialFn<C>,
  captured: Frame | null,
): LambdaValue {
  return {
    kind: 'lambda',
    params: params.map((p) => p.name),
    call: (given) => {
      if (given.length < required || given.length > params.length) return err('VALUE');
      if (ctx.depth >= MAX_LAMBDA_DEPTH) return err('NUM');
      const vals: (Value | undefined)[] = params.map((_, i) => (i < given.length ? given[i] : undefined));
      const saved = ctx.env;
      ctx.env = { vals, up: captured };
      ctx.depth++;
      try {
        return body(ctx);
      } catch (error) {
        // A recursion deeper than the stack allows ends like one deeper than the limit.
        if (error instanceof RangeError) return err('NUM');
        throw error;
      } finally {
        ctx.depth--;
        ctx.env = saved;
      }
    },
  };
}

function compileIsOmitted<C extends SpecialCtx>(args: readonly Node[], host: SpecialHost<C>): SpecialFn<C> {
  if (args.length !== 1) return constant(err('VALUE'));
  const param = paramName(args[0]);
  const local = param === null ? null : host.local(param.name);
  if (local === null) return constant(err('VALUE'));
  const { hops, slot } = local;
  return (ctx) => frameAt(ctx.env, hops)?.vals[slot] === undefined;
}

/** Calls a value as a function: one made by LAMBDA gets the arguments, an error passes on, others are #VALUE!. */
export function callValue(callee: Value, args: readonly Value[]): Value {
  if (isLambda(callee)) return callee.call(args);
  return isError(callee) ? callee : err('VALUE');
}
