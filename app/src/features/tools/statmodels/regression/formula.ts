// Model formulas as statistics courses write them: y ~ x1 + x2 + g + x1:g + x1^2 + log(x3). A star adds both main
// effects and their interaction (a*b is a + b + a:b), "- 1" or "0 +" drops the intercept, and a name with spaces
// goes in backticks. This parser is written for formulas alone: it reads names and the symbols ~ + - * : ^ ( ), and
// it never runs the text.
import type { Factor, Term } from '../kit/design';
import { fail } from '../kit/types';

export interface Formula {
  readonly response: string;
  readonly terms: readonly Term[];
  readonly intercept: boolean;
}

type Token = { kind: 'name'; text: string } | { kind: 'number'; text: string } | { kind: 'symbol'; text: string };

const SYMBOLS = new Set(['~', '+', '-', '*', ':', '^', '(', ')']);

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) i += 1;
    else if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end < 0) fail('formulaQuote');
      out.push({ kind: 'name', text: text.slice(i + 1, end) });
      i = end + 1;
    } else if (SYMBOLS.has(c)) {
      out.push({ kind: 'symbol', text: c });
      i += 1;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j])) j += 1;
      out.push({ kind: 'number', text: text.slice(i, j) });
      i = j;
    } else if (/[\p{L}_.]/u.test(c)) {
      let j = i;
      while (j < text.length && /[\p{L}\p{N}_.]/u.test(text[j])) j += 1;
      out.push({ kind: 'name', text: text.slice(i, j) });
      i = j;
    } else fail('formulaSymbol', c);
  }
  return out;
}

class Reader {
  private at = 0;
  constructor(
    private readonly tokens: readonly Token[],
    private readonly names: readonly string[],
  ) {}

  peek(ahead = 0): Token | undefined {
    return this.tokens[this.at + ahead];
  }

  take(): Token {
    const token = this.tokens[this.at];
    if (!token) fail('formulaEnd');
    this.at += 1;
    return token;
  }

  symbol(text: string): boolean {
    const token = this.peek();
    if (token?.kind === 'symbol' && token.text === text) {
      this.at += 1;
      return true;
    }
    return false;
  }

  expect(text: string): void {
    if (!this.symbol(text)) fail('formulaExpected', text);
  }

  column(): string {
    const token = this.take();
    if (token.kind !== 'name') fail('formulaName', token.text);
    if (!this.names.includes(token.text)) fail('noColumn', token.text);
    return token.text;
  }

  done(): boolean {
    return this.at >= this.tokens.length;
  }
}

/** One factor: a name, a name to a whole power, or the log of a name. */
function factor(r: Reader): Factor {
  const token = r.peek();
  const call = (name: string) => token?.kind === 'name' && token.text === name && r.peek(1)?.text === '(';
  if (call('log')) {
    r.take();
    r.expect('(');
    const name = r.column();
    r.expect(')');
    return { name, log: true };
  }
  if (call('I')) {
    r.take();
    r.expect('(');
    const inner = factor(r);
    r.expect(')');
    return inner;
  }
  const name = r.column();
  if (r.symbol('^')) {
    const power = r.take();
    const value = Number(power.text);
    if (power.kind !== 'number' || !Number.isInteger(value) || value < 1 || value > 6) fail('formulaPower');
    return { name, power: value };
  }
  return { name };
}

/** All products of a list of factor groups that a star joins: a*b*c gives a, b, c, a:b, a:c, b:c, a:b:c. */
function expandStar(groups: readonly (readonly Factor[])[]): Term[] {
  const out: Term[] = [];
  const n = groups.length;
  for (let size = 1; size <= n; size += 1)
    for (let mask = 1; mask < 1 << n; mask += 1) {
      const picked = groups.filter((_, i) => mask & (1 << i));
      if (picked.length === size) out.push({ factors: picked.flat() });
    }
  return out;
}

/** A term with stars: factors joined by : and *. */
function term(r: Reader): Term[] {
  const groups: Factor[][] = [[factor(r)]];
  for (;;) {
    if (r.symbol(':')) groups[groups.length - 1].push(factor(r));
    else if (r.symbol('*')) groups.push([factor(r)]);
    else break;
  }
  return groups.length === 1 ? [{ factors: groups[0] }] : expandStar(groups);
}

const sameTerm = (a: Term, b: Term) =>
  a.factors.length === b.factors.length &&
  a.factors.every((f) => b.factors.some((g) => g.name === f.name && (g.power ?? 1) === (f.power ?? 1) && !!g.log === !!f.log));

/** Reads a formula against the data's column names. */
export function parseFormula(text: string, names: readonly string[]): Formula {
  const r = new Reader(tokenize(text), names);
  if (r.done()) fail('formulaEmpty');
  const response = r.column();
  r.expect('~');
  let intercept = true;
  const terms: Term[] = [];
  let sign = 1;
  if (r.done()) fail('formulaEnd');
  for (;;) {
    const token = r.peek();
    if (token?.kind === 'number') {
      r.take();
      if (token.text === '0' || (token.text === '1' && sign < 0)) intercept = false;
      else if (token.text !== '1') fail('formulaName', token.text);
    } else {
      const found = term(r);
      if (sign > 0) for (const t of found) if (!terms.some((u) => sameTerm(u, t))) terms.push(t);
      if (sign < 0)
        for (const t of found) {
          const at = terms.findIndex((u) => sameTerm(u, t));
          if (at >= 0) terms.splice(at, 1);
        }
    }
    if (r.done()) break;
    if (r.symbol('+')) sign = 1;
    else if (r.symbol('-')) sign = -1;
    else fail('formulaSymbol', r.take().text);
  }
  if (terms.some((t) => t.factors.some((f) => f.name === response))) fail('outcomeIsPredictor', response);
  return { response, terms, intercept };
}
