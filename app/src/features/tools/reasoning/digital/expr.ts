// Boolean expressions as digital design writes them: A'B + CD', A·B, ~A, A ^ B, words such as NOR or XOR, and 0 and
// 1. A tokenizer and a precedence parser of its own (no eval): NOT binds tightest, then AND (also by writing two
// variables side by side), then XOR, then OR. A variable is a letter with optional digits, so AB means A AND B.
import { fail } from '../core/util';

export type BoolExpr =
  | { k: 'var'; name: string }
  | { k: 'const'; v: 0 | 1 }
  | { k: 'not'; a: BoolExpr }
  | { k: 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor'; a: BoolExpr; b: BoolExpr };

type Tok =
  | { t: 'var'; name: string }
  | { t: 'const'; v: 0 | 1 }
  | { t: 'op'; op: 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor' }
  | { t: 'not' }
  | { t: 'prime' }
  | { t: '(' }
  | { t: ')' };

const WORDS: Record<string, Tok> = {
  and: { t: 'op', op: 'and' },
  or: { t: 'op', op: 'or' },
  xor: { t: 'op', op: 'xor' },
  nand: { t: 'op', op: 'nand' },
  nor: { t: 'op', op: 'nor' },
  xnor: { t: 'op', op: 'xnor' },
  not: { t: 'not' },
};

const SYMBOLS: Record<string, Tok> = {
  '*': { t: 'op', op: 'and' },
  '·': { t: 'op', op: 'and' },
  '.': { t: 'op', op: 'and' },
  '&': { t: 'op', op: 'and' },
  '∧': { t: 'op', op: 'and' },
  '+': { t: 'op', op: 'or' },
  '|': { t: 'op', op: 'or' },
  '∨': { t: 'op', op: 'or' },
  '^': { t: 'op', op: 'xor' },
  '⊕': { t: 'op', op: 'xor' },
  '~': { t: 'not' },
  '!': { t: 'not' },
  '¬': { t: 'not' },
  "'": { t: 'prime' },
  '’': { t: 'prime' },
  '(': { t: '(' },
  ')': { t: ')' },
};

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === '0' || c === '1') {
      toks.push({ t: 'const', v: c === '1' ? 1 : 0 });
      i += 1;
    } else if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < text.length && /[A-Za-z]/.test(text[j])) j += 1;
      const word = text.slice(i, j).toLowerCase();
      if (WORDS[word] && j - i > 1) {
        toks.push(WORDS[word]);
        i = j;
      } else {
        // One letter and the digits or underscore-digits after it: A, B, x1, x_2.
        let k = i + 1;
        while (k < text.length && /[0-9_]/.test(text[k])) k += 1;
        toks.push({ t: 'var', name: text.slice(i, k) });
        i = k;
      }
    } else if (SYMBOLS[c]) {
      toks.push(SYMBOLS[c]);
      i += 1;
    } else {
      fail('badChar', { char: c });
    }
  }
  return toks;
}

class Parser {
  private at = 0;
  constructor(private readonly toks: Tok[]) {}

  parse(): BoolExpr {
    if (this.toks.length === 0) fail('empty');
    const e = this.or();
    if (this.at < this.toks.length) fail('unexpected', { at: this.at + 1 });
    return e;
  }

  private peek(): Tok | undefined {
    return this.toks[this.at];
  }

  private binary(ops: readonly string[], next: () => BoolExpr): BoolExpr {
    let left = next();
    for (let tok = this.peek(); tok?.t === 'op' && ops.includes(tok.op); tok = this.peek()) {
      this.at += 1;
      left = { k: tok.op, a: left, b: next() };
    }
    return left;
  }

  private or(): BoolExpr {
    return this.binary(['or', 'nor'], () => this.xor());
  }

  private xor(): BoolExpr {
    return this.binary(['xor', 'xnor'], () => this.and());
  }

  private and(): BoolExpr {
    let left = this.unary();
    for (;;) {
      const tok = this.peek();
      if (tok?.t === 'op' && (tok.op === 'and' || tok.op === 'nand')) {
        this.at += 1;
        left = { k: tok.op, a: left, b: this.unary() };
      } else if (tok && (tok.t === 'var' || tok.t === 'const' || tok.t === '(' || tok.t === 'not')) {
        left = { k: 'and', a: left, b: this.unary() };
      } else return left;
    }
  }

  private unary(): BoolExpr {
    const tok = this.peek();
    if (tok?.t === 'not') {
      this.at += 1;
      return this.postfix({ k: 'not', a: this.unary() });
    }
    return this.postfix(this.atom());
  }

  private postfix(e: BoolExpr): BoolExpr {
    let out = e;
    while (this.peek()?.t === 'prime') {
      this.at += 1;
      out = { k: 'not', a: out };
    }
    return out;
  }

  private atom(): BoolExpr {
    const tok = this.peek();
    if (!tok) return fail('endEarly');
    this.at += 1;
    if (tok.t === 'var') return { k: 'var', name: tok.name };
    if (tok.t === 'const') return { k: 'const', v: tok.v };
    if (tok.t === '(') {
      const inner = this.or();
      if (this.peek()?.t !== ')') fail('unclosed');
      this.at += 1;
      return inner;
    }
    return fail('unexpected', { at: this.at });
  }
}

export const parseBool = (text: string): BoolExpr => new Parser(tokenize(text)).parse();

/** The variables an expression uses, in alphabetical order. */
export function varsOf(e: BoolExpr, out = new Set<string>()): string[] {
  if (e.k === 'var') out.add(e.name);
  else if (e.k === 'not') varsOf(e.a, out);
  else if (e.k !== 'const') {
    varsOf(e.a, out);
    varsOf(e.b, out);
  }
  return [...out].sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
}

/** The value for one assignment: `env` maps each variable to 0 or 1. */
export function evalBool(e: BoolExpr, env: Readonly<Record<string, number>>): 0 | 1 {
  switch (e.k) {
    case 'var':
      return env[e.name] ? 1 : 0;
    case 'const':
      return e.v;
    case 'not':
      return evalBool(e.a, env) ? 0 : 1;
    default: {
      const a = evalBool(e.a, env);
      const b = evalBool(e.b, env);
      const v = { and: a & b, or: a | b, xor: a ^ b, nand: 1 - (a & b), nor: 1 - (a | b), xnor: 1 - (a ^ b) }[e.k];
      return v ? 1 : 0;
    }
  }
}

/** The assignment for row `row` of a truth table: the first variable is the most significant bit. */
export function rowEnv(vars: readonly string[], row: number): Record<string, number> {
  const env: Record<string, number> = {};
  vars.forEach((v, i) => (env[v] = (row >> (vars.length - 1 - i)) & 1));
  return env;
}

/** The minterms of an expression over `vars`. */
export function mintermsOf(e: BoolExpr, vars: readonly string[]): number[] {
  const out: number[] = [];
  for (let row = 0; row < 1 << vars.length; row += 1) if (evalBool(e, rowEnv(vars, row))) out.push(row);
  return out;
}

const PREC: Record<BoolExpr['k'], number> = {
  or: 1,
  nor: 1,
  xor: 2,
  xnor: 2,
  and: 3,
  nand: 3,
  not: 4,
  var: 5,
  const: 5,
};
const SHOWN: Record<string, string> = { and: '·', or: ' + ', xor: ' ⊕ ', nand: ' NAND ', nor: ' NOR ', xnor: ' XNOR ' };

/** The expression as text with the fewest parentheses, complement written with a prime. */
export function showBool(e: BoolExpr): string {
  if (e.k === 'var') return e.name;
  if (e.k === 'const') return String(e.v);
  if (e.k === 'not') {
    const inner = showBool(e.a);
    return e.a.k === 'var' || e.a.k === 'const' || e.a.k === 'not' ? `${inner}'` : `(${inner})'`;
  }
  const side = (x: BoolExpr) => (PREC[x.k] < PREC[e.k] ? `(${showBool(x)})` : showBool(x));
  return `${side(e.a)}${SHOWN[e.k]}${side(e.b)}`;
}
