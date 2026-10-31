// Relational design from functional dependencies: attribute closure, candidate keys, a minimal cover, the highest
// normal form, BCNF decomposition by splitting on a violating dependency's closure, 3NF synthesis, and the
// lossless-join (chase) and dependency-preservation tests. Attribute sets are bit masks over the schema's attributes.
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail, lines, popcount } from '../core/util';

export interface Fd {
  lhs: number;
  rhs: number;
}

export interface Schema {
  attrs: string[];
  fds: Fd[];
}

const MAX_ATTRS = 16;

/** Attribute names from `R(A, B, C)`, `A, B, C`, or `A B C`; a run like ABC splits into letters when every name is 1 letter. */
function names(text: string): string[] {
  const inner = /^\s*\w*\s*\((.*)\)\s*$/.exec(text)?.[1] ?? text;
  return inner.split(/[\s,]+/).filter(Boolean);
}

export function parseSchema(attrText: string, fdText: string): Schema {
  const attrs = [...new Set(names(attrText))];
  if (!attrs.length) fail('noAttrs');
  if (attrs.length > MAX_ATTRS) fail('tooManyAttrs', { max: MAX_ATTRS });
  const single = attrs.every((a) => a.length === 1);
  const set = (side: string, line: string): number => {
    const parts = names(side).flatMap((w) => (single && !attrs.includes(w) ? [...w] : [w]));
    if (!parts.length) fail('fdLine', { line });
    return parts.reduce((m, p) => {
      const i = attrs.indexOf(p);
      return i < 0 ? fail('unknownAttr', { name: p, line }) : m | (1 << i);
    }, 0);
  };
  const fds = lines(fdText)
    .flatMap((l) => l.split(';'))
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(.+?)\s*(?:->|→)\s*(.+)$/.exec(l);
      if (!m) fail('fdLine', { line: l });
      return { lhs: set(m![1], l), rhs: set(m![2], l) };
    });
  return { attrs, fds };
}

export const setText = (attrs: readonly string[], m: number): string =>
  attrs.filter((_, i) => m & (1 << i)).join(attrs.every((a) => a.length === 1) ? '' : ' ');

export const fdText = (attrs: readonly string[], f: Fd): string =>
  `${setText(attrs, f.lhs)} → ${setText(attrs, f.rhs)}`;

export function attrSet(attrs: readonly string[], text: string): number {
  const single = attrs.every((a) => a.length === 1);
  const parts = names(text).flatMap((w) => (single && !attrs.includes(w) ? [...w] : [w]));
  if (!parts.length) fail('noClosureSet');
  return parts.reduce((m, p) => {
    const i = attrs.indexOf(p);
    return i < 0 ? fail('unknownAttr', { name: p, line: text }) : m | (1 << i);
  }, 0);
}

/** X+ under the dependencies, with the dependency used at each growth when `log` is given. */
export function closure(x: number, fds: readonly Fd[], log?: Fd[]): number {
  let c = x;
  for (let grew = true; grew;) {
    grew = false;
    for (const f of fds)
      if ((f.lhs & c) === f.lhs && (f.rhs & ~c) !== 0) {
        c |= f.rhs;
        grew = true;
        log?.push(f);
      }
  }
  return c;
}

/** Every subset of `within`, smallest first. */
function subsets(within: number): number[] {
  const out: number[] = [];
  for (let s = within; ; s = (s - 1) & within) {
    out.push(s);
    if (s === 0) break;
  }
  return out.sort((a, b) => popcount(a) - popcount(b) || a - b);
}

/** The candidate keys of `rel` (all attributes by default): minimal sets whose closure covers it. */
export function candidateKeys(nAttrs: number, fds: readonly Fd[], rel = (1 << nAttrs) - 1): number[] {
  const inRhs = fds.reduce((m, f) => m | f.rhs, 0);
  const must = rel & ~inRhs;
  const keys: number[] = [];
  for (const extra of subsets(rel & ~must)) {
    const k = must | extra;
    if (keys.some((q) => (q & k) === q)) continue;
    if ((closure(k, fds) & rel) === rel) keys.push(k);
  }
  return keys;
}

/** A minimal cover: single attributes on the right, no extraneous attribute on the left, no redundant dependency. */
export function minimalCover(fds: readonly Fd[], attrs: readonly string[] = []): { cover: Fd[]; steps: Step[] } {
  const steps: Step[] = [];
  let g: Fd[] = fds.flatMap((f) =>
    [...Array(MAX_ATTRS).keys()].filter((i) => f.rhs & ~f.lhs & (1 << i)).map((i) => ({ lhs: f.lhs, rhs: 1 << i })),
  );
  steps.push(step('coverSplit', { count: g.length }));
  g = g.map((f) => {
    let lhs = f.lhs;
    for (let i = 0; i < MAX_ATTRS; i += 1) {
      const bit = 1 << i;
      if (!(lhs & bit) || popcount(lhs) === 1) continue;
      if ((closure(lhs & ~bit, g) & f.rhs) === f.rhs) {
        steps.push(step('coverLhs', { fd: fdText(attrs, { lhs, rhs: f.rhs }), attr: attrs[i] ?? '' }));
        lhs &= ~bit;
      }
    }
    return { lhs, rhs: f.rhs };
  });
  g = g.filter((f, i, all) => all.findIndex((q) => q.lhs === f.lhs && q.rhs === f.rhs) === i);
  for (let i = 0; i < g.length;) {
    const rest = g.filter((_, j) => j !== i);
    if ((closure(g[i].lhs, rest) & g[i].rhs) === g[i].rhs) {
      steps.push(step('coverDrop', { fd: fdText(attrs, g[i]) }));
      g = rest;
    } else i += 1;
  }
  return { cover: g, steps };
}

/** Dependencies that hold on `rel`, as X → (X+ ∩ rel) − X for each proper subset X, smallest first. */
function projected(rel: number, fds: readonly Fd[]): Fd[] {
  const out: Fd[] = [];
  for (const x of subsets(rel)) {
    if (x === 0 || x === rel) continue;
    const rhs = closure(x, fds) & rel & ~x;
    if (rhs) out.push({ lhs: x, rhs });
  }
  return out;
}

/** A dependency on `rel` that breaks BCNF: the given ones first, then any found by projection. */
function bcnfViolation(rel: number, fds: readonly Fd[]): number | null {
  const tries = [
    ...fds.filter((f) => (f.lhs & rel) === f.lhs).map((f) => f.lhs),
    ...projected(rel, fds).map((f) => f.lhs),
  ];
  for (const x of tries) {
    const c = closure(x, fds) & rel;
    if (c !== x && c !== rel && (c & ~x) !== 0) return x;
  }
  return null;
}

export type NormalForm = 'bcnf' | '3nf' | '2nf' | '1nf';

export function normalForm(nAttrs: number, fds: readonly Fd[]): { form: NormalForm; breaks: Fd | null } {
  const all = (1 << nAttrs) - 1;
  const keys = candidateKeys(nAttrs, fds);
  const prime = keys.reduce((m, k) => m | k, 0);
  const isSuper = (x: number) => (closure(x, fds) & all) === all;
  const nontrivial = minimalCover(fds).cover.filter((f) => (f.rhs & ~f.lhs) !== 0);
  const bcnf = nontrivial.find((f) => !isSuper(f.lhs));
  if (!bcnf) return { form: 'bcnf', breaks: null };
  const third = nontrivial.find((f) => !isSuper(f.lhs) && (f.rhs & ~prime) !== 0);
  if (!third) return { form: '3nf', breaks: bcnf };
  const partial = nontrivial.find(
    (f) => (f.rhs & ~prime) !== 0 && keys.some((k) => (f.lhs & k) === f.lhs && f.lhs !== k),
  );
  return partial ? { form: '1nf', breaks: partial } : { form: '2nf', breaks: third };
}

/** BCNF by recursive splitting: R becomes X+ and R − (X+ − X) whenever X+ is neither X nor all of R. */
export function bcnf(attrs: readonly string[], fds: readonly Fd[]): { parts: number[]; steps: Step[] } {
  const nAttrs = attrs.length;
  const t = (m: number) => setText(attrs, m);
  const steps: Step[] = [];
  const split = (rel: number): number[] => {
    const x = bcnfViolation(rel, fds);
    if (x === null) return [rel];
    const c = closure(x, fds) & rel;
    steps.push(step('bcnfSplit', { rel: t(rel), x: t(x), closure: t(c), a: t(c), b: t(rel & ~(c & ~x)) }));
    return [...split(c), ...split(rel & ~(c & ~x))];
  };
  const parts = split((1 << nAttrs) - 1);
  return {
    parts: parts.filter((p, i) => !parts.some((q, j) => j !== i && (p & q) === p && (p !== q || j < i))),
    steps,
  };
}

/** 3NF synthesis: a relation per left side of a minimal cover, a key if none holds one, and no relation inside another. */
export function synthesize3nf(nAttrs: number, fds: readonly Fd[]): { parts: number[]; addedKey: number | null } {
  const { cover } = minimalCover(fds);
  const groups = new Map<number, number>();
  for (const f of cover) groups.set(f.lhs, (groups.get(f.lhs) ?? f.lhs) | f.rhs);
  let parts = [...groups.values()];
  const keys = candidateKeys(nAttrs, fds);
  let addedKey: number | null = null;
  if (!parts.some((p) => keys.some((k) => (k & p) === k))) {
    addedKey = keys[0];
    parts.push(keys[0]);
  }
  parts = parts.filter((p, i) => !parts.some((q, j) => j !== i && (p & q) === p && (p !== q || j < i)));
  return { parts, addedKey };
}

/** The chase: a row per part, distinguished symbols where the part has the attribute; lossless when a row fills up. */
export function lossless(nAttrs: number, fds: readonly Fd[], parts: readonly number[]): boolean {
  // Cell value: 0 is the distinguished symbol; otherwise row-specific labels.
  const t = parts.map((p, r) => Array.from({ length: nAttrs }, (_, a) => (p & (1 << a) ? 0 : 1 + r * nAttrs + a)));
  for (let changed = true; changed;) {
    changed = false;
    for (const f of fds)
      for (let i = 0; i < t.length; i += 1)
        for (let j = i + 1; j < t.length; j += 1) {
          let agree = true;
          for (let a = 0; a < nAttrs; a += 1) if (f.lhs & (1 << a) && t[i][a] !== t[j][a]) agree = false;
          if (!agree) continue;
          for (let a = 0; a < nAttrs; a += 1) {
            if (!(f.rhs & (1 << a)) || t[i][a] === t[j][a]) continue;
            const [keep, drop] = t[i][a] < t[j][a] ? [t[i][a], t[j][a]] : [t[j][a], t[i][a]];
            for (const row of t) if (row[a] === drop) row[a] = keep;
            changed = true;
          }
        }
  }
  return t.some((row) => row.every((x) => x === 0));
}

/** The dependencies that no part's projected dependencies can derive. */
export function lostDependencies(fds: readonly Fd[], parts: readonly number[]): Fd[] {
  return fds.filter((f) => {
    let z = f.lhs;
    for (let grew = true; grew;) {
      grew = false;
      for (const p of parts) {
        const add = closure(z & p, fds) & p;
        if (add & ~z) {
          z |= add;
          grew = true;
        }
      }
    }
    return (f.rhs & z) !== f.rhs;
  });
}
