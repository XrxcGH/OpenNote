// Regular expressions as trees: a parser of their own, a printer that adds only the parentheses precedence needs, and
// constructors that simplify as they build (so state elimination gives readable answers). Union is |, the empty
// string is ε, the empty language is ∅, and *, +, and ? repeat. Spaces are ignored; a backslash quotes the next
// character.
import { fail } from '../core/util';

export type Re =
  | { k: 'none' }
  | { k: 'eps' }
  | { k: 'sym'; c: string }
  | { k: 'alt'; items: readonly Re[] }
  | { k: 'cat'; items: readonly Re[] }
  | { k: 'star'; r: Re }
  | { k: 'plus'; r: Re }
  | { k: 'opt'; r: Re };

export const NONE: Re = { k: 'none' };
export const EPS: Re = { k: 'eps' };
export const sym = (c: string): Re => ({ k: 'sym', c });

export function alt(...parts: readonly Re[]): Re {
  const items: Re[] = [];
  const seen = new Set<string>();
  for (const p of parts.flatMap((x) => (x.k === 'alt' ? x.items : [x]))) {
    if (p.k === 'none') continue;
    const key = print(p);
    if (!seen.has(key)) {
      seen.add(key);
      items.push(p);
    }
  }
  if (items.length === 0) return NONE;
  if (items.length === 1) return items[0];
  // The union of ε with a starred expression is that expression, and ε with anything else is an option.
  const eps = items.findIndex((x) => x.k === 'eps');
  if (eps >= 0 && items.length === 2) {
    const other = items[1 - eps];
    return other.k === 'star' || other.k === 'opt' ? other : { k: 'opt', r: other };
  }
  return { k: 'alt', items };
}

export function cat(...parts: readonly Re[]): Re {
  if (parts.some((p) => p.k === 'none')) return NONE;
  const items = parts.flatMap((x) => (x.k === 'cat' ? x.items : x.k === 'eps' ? [] : [x]));
  if (items.length === 0) return EPS;
  return items.length === 1 ? items[0] : { k: 'cat', items };
}

export function star(r: Re): Re {
  if (r.k === 'none' || r.k === 'eps') return EPS;
  if (r.k === 'star') return r;
  if (r.k === 'plus' || r.k === 'opt') return { k: 'star', r: r.r };
  return { k: 'star', r };
}

const PRECEDENCE: Record<Re['k'], number> = { none: 3, eps: 3, sym: 3, star: 2, plus: 2, opt: 2, cat: 1, alt: 0 };

/** The expression as text, with the fewest parentheses. */
export function print(r: Re): string {
  const wrap = (x: Re, min: number) => (PRECEDENCE[x.k] < min ? `(${print(x)})` : print(x));
  switch (r.k) {
    case 'none':
      return '∅';
    case 'eps':
      return 'ε';
    case 'sym':
      return /[()|*+?\\ε∅]/.test(r.c) ? `\\${r.c}` : r.c;
    case 'alt':
      return r.items.map((x) => wrap(x, 1)).join('|');
    case 'cat':
      return r.items.map((x) => wrap(x, 2)).join('');
    case 'star':
      return `${wrap(r.r, 3)}*`;
    case 'plus':
      return `${wrap(r.r, 3)}+`;
    case 'opt':
      return `${wrap(r.r, 3)}?`;
  }
}

/** Parses a regular expression; raises `regex` with the position of the first problem. */
export function parseRegex(text: string): Re {
  const chars = [...text].filter((c) => !/\s/.test(c));
  if (chars.length === 0) return fail('regexEmpty');
  let i = 0;
  const peek = () => chars[i];
  const union = (): Re => {
    const parts = [concat()];
    while (peek() === '|') {
      i += 1;
      parts.push(concat());
    }
    // A union keeps every branch, even repeated ones, so a typed expression is drawn as typed.
    return parts.length === 1 ? parts[0] : { k: 'alt', items: parts };
  };
  const concat = (): Re => {
    const parts: Re[] = [];
    while (i < chars.length && peek() !== '|' && peek() !== ')') parts.push(repeat());
    if (parts.length === 0) return EPS;
    return parts.length === 1 ? parts[0] : { k: 'cat', items: parts };
  };
  const repeat = (): Re => {
    let r = atom();
    while (peek() === '*' || peek() === '+' || peek() === '?') {
      const op = chars[i++];
      r = { k: op === '*' ? 'star' : op === '+' ? 'plus' : 'opt', r };
    }
    return r;
  };
  const atom = (): Re => {
    const c = chars[i];
    if (c === '(') {
      i += 1;
      const inner = union();
      if (peek() !== ')') fail('regexParen', { at: i + 1 });
      i += 1;
      return inner;
    }
    if (c === '*' || c === '+' || c === '?' || c === ')') return fail('regexAt', { at: i + 1, c });
    i += 1;
    if (c === 'ε') return EPS;
    if (c === '∅') return NONE;
    if (c === '\\') {
      if (i >= chars.length) return fail('regexAt', { at: i, c });
      return sym(chars[i++]);
    }
    return sym(c);
  };
  const r = union();
  if (i < chars.length) fail('regexAt', { at: i + 1, c: chars[i] });
  return r;
}

/** The symbols an expression uses, sorted. */
export function symbolsOf(r: Re): string[] {
  const out = new Set<string>();
  const walk = (x: Re) => {
    if (x.k === 'sym') out.add(x.c);
    else if (x.k === 'alt' || x.k === 'cat') x.items.forEach(walk);
    else if (x.k === 'star' || x.k === 'plus' || x.k === 'opt') walk(x.r);
  };
  walk(r);
  return [...out].sort();
}
