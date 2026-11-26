// The compiler's view of the function library. The functions themselves live in fn/, one file per family (ADR 0060).
// This adapter runs each FnSpec2 on the current compiler: a function whose first parameter is a range is an
// aggregate, which takes flat lists, and a function with lazy parameters is a special form the compiler evaluates
// itself. Array arguments and results wait for lane engine-eval.

import { REGISTRY, arity, isSpecial, paramsOf, type Env, type FnSpec2 } from './fn';
import type { Value } from '../values';

export type { Env };

export interface FnSpec {
  /** Aggregates take flat lists, so a column argument means every cell in it. */
  kind: 'scalar' | 'aggregate';
  min: number;
  /** Infinity for functions that take any number of arguments. */
  max: number;
  /** When set, an error argument reaches the function instead of becoming its result. */
  handlesErrors?: boolean;
  /** When set, arguments pass as they are and aren't coerced to numbers. */
  raw?: boolean;
  run: (args: Value[], env: Env) => Value;
}

/** The compiler's form of a library function. */
export function toFnSpec(spec: FnSpec2): FnSpec {
  const params = paramsOf(spec);
  const first = params[0];
  const aggregate = first?.kind === 'range';
  return {
    kind: aggregate ? 'aggregate' : 'scalar',
    ...arity(spec),
    ...(spec.handlesErrors === true ? { handlesErrors: true } : {}),
    ...(aggregate && first.direct === 'raw' ? { raw: true } : {}),
    run: spec.run,
  };
}

const plain = [...REGISTRY.values()].filter((spec) => !isSpecial(spec));
const special = [...REGISTRY.values()].filter(isSpecial);

/** Every function by uppercase name, except the special forms. */
export const FUNCTIONS: Record<string, FnSpec> = Object.fromEntries(plain.map((spec) => [spec.name, toFnSpec(spec)]));

/** Functions with lazy arguments, IF and IFERROR, which the compiler evaluates itself. */
export const SPECIAL_FORMS: Record<string, { min: number; max: number }> = Object.fromEntries(
  special.map((spec) => [spec.name, arity(spec)]),
);
