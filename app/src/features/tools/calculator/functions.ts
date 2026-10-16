// The functions an expression can call. Names are not case-sensitive, and the dialect knows the aliases such as
// arcsin and log10. The definitions live in the shared engine (core/expr), so the calculator, the grapher, and the
// smart tables agree on what sin and sqrt mean. This file lists them for a function picker.

import { FUNCTION_NAMES, TABLE } from './dialect';

/** Every function with its argument counts, for a function picker. */
export const FUNCTIONS: readonly { name: string; min: number; max: number }[] = FUNCTION_NAMES.map((name) => ({
  name,
  min: TABLE[name].min,
  max: TABLE[name].max,
}));
