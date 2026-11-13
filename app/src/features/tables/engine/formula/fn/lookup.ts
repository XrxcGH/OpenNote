// Lookup and reference functions. Owner: tables:fn-lookup. The searching functions are in lookupFind.ts, the
// reference functions in lookupRefs.ts, and their shared rules in lookupKit.ts. Descriptions: strings/en/fnLookup.ts.

import type { Node } from '../../../../../core/expr';
import { parseFormula } from '../parser';
import { findFunctions } from './lookupFind';
import { refFunctions } from './lookupRefs';
import type { FnSpec2 } from './types';

export const functions: readonly FnSpec2[] = [...findFunctions, ...refFunctions];

export { addressText, columnLetters, parseRefText } from './lookupRefs';

/** Link kinds a click may open. Anything else stays plain text. */
const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

/**
 * The link a cell's formula draws, for the display: set when the formula is a call to HYPERLINK whose location is
 * written as text and starts with http, https, or mailto. The display draws it as a link and opens it only on a
 * click. `formula` is the stored formula, without "=".
 */
export function hyperlinkOf(formula: string): string | null {
  const parsed = parseFormula(formula, undefined, { legacy: false });
  if (!parsed.ok) return null;
  const node: Node = parsed.node;
  if (node.type !== 'call' || node.name.toUpperCase() !== 'HYPERLINK' || node.callee !== undefined) return null;
  const first = node.args[0];
  if (first?.type !== 'str') return null;
  const url = first.value.trim();
  return SAFE_LINK.test(url) ? url : null;
}
