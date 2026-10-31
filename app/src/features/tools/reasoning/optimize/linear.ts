// Linear programs typed as text: an objective such as "max 3x + 2y" and one constraint per line, such as
// "x + 3y <= 6". Coefficients may be whole, decimal, or fractions (1/2 x); variables are letters with optional digits.
// Every variable is at least 0; a line such as "x >= 0" is read as that bound and skipped.
import { ZERO, add, frac, isZero, neg, parseFrac, sub } from '../core/frac';
import type { Frac } from '../core/frac';
import type { Lp, Op } from '../core/simplex';
import { fail, lines } from '../core/util';

export interface ParsedLp {
  lp: Lp;
  vars: string[];
  /** Each constraint as typed, for tables. */
  labels: string[];
}

interface Linear {
  terms: Map<string, Frac>;
  constant: Frac;
}

const TERM = /([+-]?)\s*((?:\d+(?:\.\d*)?|\.\d+)(?:\s*\/\s*\d+)?)?\s*\*?\s*([A-Za-z][A-Za-z0-9_]*)?/y;

/** A linear expression such as 3x - 1/2 y + 4 as coefficients and a constant. */
export function parseLinear(text: string, line: number): Linear {
  const src = text.replace(/−/g, '-').replace(/·/g, '*').trim();
  if (!src) fail('lpEmptySide', { line });
  const terms = new Map<string, Frac>();
  let constant = ZERO;
  let at = 0;
  let first = true;
  while (at < src.length) {
    while (src[at] === ' ') at += 1;
    if (at >= src.length) break;
    TERM.lastIndex = at;
    const m = TERM.exec(src);
    if (!m || m[0].trim() === '' || (!first && !m[1])) fail('lpTerm', { line, text: src.slice(at, at + 12) });
    const [, sgn, coef, name] = m!;
    if (!coef && !name) fail('lpTerm', { line, text: src.slice(at, at + 12) });
    let value = coef ? parseFrac(coef.replace(/\s+/g, '')) : frac(1);
    if (value === null) return fail('lpTerm', { line, text: coef });
    if (sgn === '-') value = neg(value);
    if (name) terms.set(name, add(terms.get(name) ?? ZERO, value));
    else constant = add(constant, value);
    at = TERM.lastIndex;
    first = false;
  }
  return { terms, constant };
}

const OPS: [RegExp, Op][] = [
  [/<=|≤|=<|</, '<='],
  [/>=|≥|=>|>/, '>='],
  [/==|=/, '='],
];

function splitConstraint(text: string, line: number): [string, Op, string] {
  for (const [re, op] of OPS) {
    const m = re.exec(text);
    if (m) return [text.slice(0, m.index), op, text.slice(m.index + m[0].length)];
  }
  return fail('lpNoOp', { line });
}

/** Reads the objective line and the constraint lines into a program over the variables in order of appearance. */
export function parseLp(objective: string, constraints: string): ParsedLp {
  const head = /^\s*(max(?:imize|imise)?|min(?:imize|imise)?)\b\s*:?\s*(?:z\s*=\s*)?(.*)$/i.exec(objective);
  if (!head) fail('lpSense');
  const sense = head![1].toLowerCase().startsWith('max') ? 'max' : 'min';
  const obj = parseLinear(head![2], 0);
  if (obj.terms.size === 0) fail('lpNoVars');
  const vars = [...obj.terms.keys()];
  const rows: { terms: Map<string, Frac>; op: Op; b: Frac; label: string }[] = [];
  lines(constraints).forEach((text, i) => {
    const line = i + 1;
    const [l, op, r] = splitConstraint(text, line);
    const left = parseLinear(l, line);
    const right = parseLinear(r, line);
    const terms = new Map(left.terms);
    for (const [k, v] of right.terms) terms.set(k, sub(terms.get(k) ?? ZERO, v));
    for (const [k, v] of terms) if (isZero(v)) terms.delete(k);
    const b = sub(right.constant, left.constant);
    if (terms.size === 0) fail('lpNoVarsLine', { line });
    const bound = terms.size === 1 && isZero(b) && op === '>=' && [...terms.values()][0].n > 0n;
    if (bound) return;
    for (const k of terms.keys()) if (!vars.includes(k)) vars.push(k);
    rows.push({ terms, op, b, label: text });
  });
  if (rows.length === 0) fail('lpNoRows');
  if (vars.length > 12 || rows.length > 15) fail('lpTooBig', { vars: 12, rows: 15 });
  const c = vars.map((v) => obj.terms.get(v) ?? ZERO);
  return {
    vars,
    labels: rows.map((r) => r.label),
    lp: {
      sense,
      c,
      rows: rows.map((r) => ({ a: vars.map((v) => r.terms.get(v) ?? ZERO), op: r.op, b: r.b })),
    },
  };
}

/** A row of coefficients as text such as 3x + 2y, for tables and the dual. */
export function linearText(a: readonly Frac[], vars: readonly string[]): string {
  const parts: string[] = [];
  a.forEach((v, i) => {
    if (isZero(v)) return;
    const negative = v.n < 0n;
    const size = negative ? neg(v) : v;
    const coef = size.n === 1n && size.d === 1n ? '' : size.d === 1n ? `${size.n}` : `(${size.n}/${size.d})`;
    parts.push(`${parts.length ? (negative ? ' − ' : ' + ') : negative ? '−' : ''}${coef}${vars[i]}`);
  });
  return parts.join('') || '0';
}
