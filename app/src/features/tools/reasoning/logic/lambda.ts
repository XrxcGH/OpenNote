// The untyped lambda calculus: terms typed as \x. M or λx. M (several binders may share one λ), numerals read as
// Church numerals, and definitions such as `plus = \m n f x. m f (n f x)` on lines before the term. Reduction is
// normal order on de Bruijn-indexed terms, so no capture can happen; printing renames a binder when its name would
// clash (alpha renaming).
import { fail, lines } from '../core/util';

export type Lam =
  | { k: 'v'; i: number }
  | { k: 'free'; name: string }
  | { k: 'l'; hint: string; body: Lam }
  | { k: 'a'; f: Lam; x: Lam };

/** Standard combinators and Church encodings, usable by name. */
export const LIBRARY: Record<string, string> = {
  I: '\\x. x',
  K: '\\x y. x',
  S: '\\x y z. x z (y z)',
  Y: '\\f. (\\x. f (x x)) (\\x. f (x x))',
  omega: '(\\x. x x) (\\x. x x)',
  true: '\\x y. x',
  false: '\\x y. y',
  and: '\\p q. p q p',
  or: '\\p q. p p q',
  not: '\\p. p (\\x y. y) (\\x y. x)',
  succ: '\\n f x. f (n f x)',
  plus: '\\m n f x. m f (n f x)',
  times: '\\m n f. m (n f)',
  pow: '\\b e. e b',
  pred: '\\n f x. n (\\g h. h (g f)) (\\u. x) (\\u. u)',
  iszero: '\\n. n (\\x. \\a b. b) (\\a b. a)',
};

export const MAX_SIZE = 20_000;

function church(n: number): Lam {
  let body: Lam = { k: 'v', i: 0 };
  for (let j = 0; j < n; j += 1) body = { k: 'a', f: { k: 'v', i: 1 }, x: body };
  return { k: 'l', hint: 'f', body: { k: 'l', hint: 'x', body } };
}

function parseTerm(text: string, defs: Map<string, Lam>): Lam {
  const toks = text.match(/\\|λ|\.|\(|\)|[A-Za-z_][A-Za-z0-9_']*|\d+|\S/g) ?? [];
  let i = 0;
  const term = (env: string[]): Lam => {
    if (toks[i] === '\\' || toks[i] === 'λ') {
      i += 1;
      const vars: string[] = [];
      while (toks[i] && /^[A-Za-z_]/.test(toks[i])) vars.push(toks[i++]);
      if (!vars.length || toks[i] !== '.') fail('lambdaBinder', { at: i + 1 });
      i += 1;
      let body = term([...vars].reverse().concat(env));
      for (let j = vars.length - 1; j >= 0; j -= 1) body = { k: 'l', hint: vars[j], body };
      return body;
    }
    let f: Lam | null = null;
    while (i < toks.length && toks[i] !== ')') {
      if (toks[i] === '\\' || toks[i] === 'λ') {
        const x = term(env);
        f = f ? { k: 'a', f, x } : x;
        break;
      }
      const x = atom(env);
      f = f ? { k: 'a', f, x } : x;
    }
    return f ?? fail('lambdaEmpty');
  };
  const atom = (env: string[]): Lam => {
    const t = toks[i++];
    if (t === '(') {
      const inner = term(env);
      if (toks[i] !== ')') fail('lambdaParen');
      i += 1;
      return inner;
    }
    if (/^\d+$/.test(t)) {
      if (Number(t) > 1000) fail('numeralBig', { max: 1000 });
      return church(Number(t));
    }
    if (/^[A-Za-z_]/.test(t)) {
      const at = env.indexOf(t);
      if (at >= 0) return { k: 'v', i: at };
      const d = defs.get(t);
      return d ?? { k: 'free', name: t };
    }
    return fail('lambdaChar', { c: t });
  };
  if (!toks.length) fail('lambdaEmpty');
  const out = term([]);
  if (i < toks.length) fail('lambdaParen');
  return out;
}

/** Definitions on lines of the form `name = term`, then the term on the last line. */
export function parseProgram(text: string): Lam {
  const defs = new Map<string, Lam>();
  for (const [name, body] of Object.entries(LIBRARY)) defs.set(name, parseTerm(body, defs));
  const all = lines(text);
  if (!all.length) fail('lambdaEmpty');
  for (const line of all.slice(0, -1)) {
    const m = /^([A-Za-z_][A-Za-z0-9_']*)\s*=\s*(.+)$/.exec(line);
    if (!m) fail('lambdaDefinition', { line });
    defs.set(m![1], parseTerm(m![2], defs));
  }
  return parseTerm(all[all.length - 1], defs);
}

function shift(t: Lam, by: number, cutoff = 0): Lam {
  switch (t.k) {
    case 'v':
      return t.i >= cutoff ? { k: 'v', i: t.i + by } : t;
    case 'free':
      return t;
    case 'l':
      return { ...t, body: shift(t.body, by, cutoff + 1) };
    case 'a':
      return { k: 'a', f: shift(t.f, by, cutoff), x: shift(t.x, by, cutoff) };
  }
}

function substitute(t: Lam, j: number, s: Lam): Lam {
  switch (t.k) {
    case 'v':
      return t.i === j ? s : t;
    case 'free':
      return t;
    case 'l':
      return { ...t, body: substitute(t.body, j + 1, shift(s, 1)) };
    case 'a':
      return { k: 'a', f: substitute(t.f, j, s), x: substitute(t.x, j, s) };
  }
}

const beta = (l: Extract<Lam, { k: 'l' }>, arg: Lam): Lam => shift(substitute(l.body, 0, shift(arg, 1)), -1);

/** One normal-order step: the leftmost, outermost redex. Null when the term is in normal form. */
export function step(t: Lam): Lam | null {
  if (t.k === 'a') {
    if (t.f.k === 'l') return beta(t.f, t.x);
    const f = step(t.f);
    if (f) return { k: 'a', f, x: t.x };
    const x = step(t.x);
    return x ? { k: 'a', f: t.f, x } : null;
  }
  if (t.k === 'l') {
    const b = step(t.body);
    return b ? { ...t, body: b } : null;
  }
  return null;
}

export const size = (t: Lam): number => (t.k === 'l' ? 1 + size(t.body) : t.k === 'a' ? 1 + size(t.f) + size(t.x) : 1);

export function reduce(t: Lam, limit: number): { terms: Lam[]; normal: boolean; steps: number; tooBig: boolean } {
  const terms = [t];
  let cur = t;
  for (let n = 0; n < limit; n += 1) {
    const next = step(cur);
    if (!next) return { terms, normal: true, steps: n, tooBig: false };
    if (size(next) > MAX_SIZE) return { terms, normal: false, steps: n + 1, tooBig: true };
    cur = next;
    if (terms.length < 60) terms.push(cur);
    else terms[terms.length - 1] = cur;
  }
  return { terms, normal: step(cur) === null, steps: limit, tooBig: false };
}

function freeNames(t: Lam, out = new Set<string>()): Set<string> {
  if (t.k === 'free') out.add(t.name);
  else if (t.k === 'l') freeNames(t.body, out);
  else if (t.k === 'a') {
    freeNames(t.f, out);
    freeNames(t.x, out);
  }
  return out;
}

/** The term with names, renaming a binder (x, x′, x″, …) when its name is already in use around it. */
export function print(t: Lam): string {
  const free = freeNames(t);
  const go = (u: Lam, ctx: string[]): string => {
    switch (u.k) {
      case 'v':
        return ctx[u.i] ?? `#${u.i}`;
      case 'free':
        return u.name;
      case 'l': {
        let name = u.hint;
        while (ctx.includes(name) || free.has(name)) name += '′';
        return `λ${name}. ${go(u.body, [name, ...ctx])}`;
      }
      case 'a': {
        const f = u.f.k === 'l' ? `(${go(u.f, ctx)})` : go(u.f, ctx);
        const x = u.x.k === 'a' || u.x.k === 'l' ? `(${go(u.x, ctx)})` : go(u.x, ctx);
        return `${f} ${x}`;
      }
    }
  };
  return go(t, []);
}

/** The number a Church numeral stands for, or null. */
export function numeral(t: Lam): number | null {
  if (t.k !== 'l' || t.body.k !== 'l') return null;
  let n = 0;
  let b: Lam = t.body.body;
  while (b.k === 'a' && b.f.k === 'v' && b.f.i === 1) {
    n += 1;
    b = b.x;
  }
  return b.k === 'v' && b.i === 0 ? n : null;
}

export function boolean(t: Lam): boolean | null {
  if (t.k !== 'l' || t.body.k !== 'l' || t.body.body.k !== 'v') return null;
  return t.body.body.i === 1 ? true : t.body.body.i === 0 ? false : null;
}
