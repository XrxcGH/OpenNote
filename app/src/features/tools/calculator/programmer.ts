// The programmer calculator: whole numbers in binary, octal, decimal, or hexadecimal, with bitwise operators, in a
// word of 8, 16, 32, or 64 bits, signed or not. Every step wraps to the word as hardware does, so 0x7F + 1 in a
// signed byte is -128. It works on BigInt, so 64-bit values are exact. The text is read here and never run as code.
//
// Precedence from loosest to tightest: | (or), ^ (xor), & (and), << and >>, + and -, * / and %, then a leading
// -, ~ (not), or the words "not", "and", "or", "xor", "shl", "shr", and "mod".

export type Base = 2 | 8 | 10 | 16;
export type WordSize = 8 | 16 | 32 | 64;

export interface ProgrammerOptions {
  base: Base;
  bits: WordSize;
  signed: boolean;
}

export const DEFAULT_PROGRAMMER: ProgrammerOptions = { base: 10, bits: 32, signed: true };

export type ProgrammerError = 'empty' | 'too-long' | 'bad-digit' | 'syntax' | 'divide-by-zero';

export type ProgrammerResult = { ok: true; value: bigint } | { ok: false; error: ProgrammerError; position: number };

const MAX_LENGTH = 1000;
const WORDS: Readonly<Record<string, string>> = {
  and: '&',
  or: '|',
  xor: '^',
  not: '~',
  shl: '<<',
  shr: '>>',
  mod: '%',
};
const PREFIX: Readonly<Record<string, Base>> = { '0x': 16, '0b': 2, '0o': 8, '0d': 10 };

class Problem extends Error {
  constructor(
    readonly code: ProgrammerError,
    readonly position: number,
  ) {
    super(code);
  }
}

interface Token {
  kind: 'num' | 'op' | 'lparen' | 'rparen';
  text: string;
  value?: bigint;
  pos: number;
}

const DIGITS = '0123456789abcdef';

function readNumber(text: string, base: Base, pos: number): bigint {
  const clean = text.replace(/_/g, '');
  if (clean === '') throw new Problem('bad-digit', pos);
  let value = 0n;
  for (const char of clean.toLowerCase()) {
    const digit = DIGITS.indexOf(char);
    if (digit < 0 || digit >= base) throw new Problem('bad-digit', pos);
    value = value * BigInt(base) + BigInt(digit);
  }
  return value;
}

function tokenize(source: string, base: Base): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === '(' || c === ')') {
      tokens.push({ kind: c === '(' ? 'lparen' : 'rparen', text: c, pos: i });
      i += 1;
    } else if (source.startsWith('<<', i) || source.startsWith('>>', i)) {
      tokens.push({ kind: 'op', text: source.slice(i, i + 2), pos: i });
      i += 2;
    } else if ('+-*/%&|^~'.includes(c)) {
      tokens.push({ kind: 'op', text: c, pos: i });
      i += 1;
    } else if (/[0-9a-z_]/i.test(c)) {
      let j = i;
      while (j < source.length && /[0-9a-z_]/i.test(source[j])) j += 1;
      const word = source.slice(i, j);
      const lower = word.toLowerCase();
      if (Object.hasOwn(WORDS, lower)) tokens.push({ kind: 'op', text: WORDS[lower], pos: i });
      else {
        const prefix = PREFIX[lower.slice(0, 2)];
        const value = prefix ? readNumber(word.slice(2), prefix, i) : readNumber(word, base, i);
        tokens.push({ kind: 'num', text: word, value, pos: i });
      }
      i = j;
    } else throw new Problem('syntax', i);
  }
  return tokens;
}

const LEVELS: readonly (readonly string[])[] = [['|'], ['^'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];

class Reader {
  private at = 0;
  constructor(
    private tokens: Token[],
    private wrap: (v: bigint) => bigint,
    private bits: number,
    private end: number,
  ) {}

  run(): bigint {
    const value = this.level(0);
    if (this.at < this.tokens.length) throw new Problem('syntax', this.tokens[this.at].pos);
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private level(depth: number): bigint {
    if (depth === LEVELS.length) return this.unary();
    let left = this.level(depth + 1);
    for (;;) {
      const token = this.peek();
      if (token?.kind !== 'op' || !LEVELS[depth].includes(token.text)) return left;
      this.at += 1;
      const right = this.level(depth + 1);
      left = this.wrap(this.apply(token, left, right));
    }
  }

  private apply(token: Token, a: bigint, b: bigint): bigint {
    const shift = Number(BigInt.asUintN(32, b) % BigInt(this.bits + 1));
    switch (token.text) {
      case '|':
        return a | b;
      case '^':
        return a ^ b;
      case '&':
        return a & b;
      case '<<':
        return a << BigInt(shift);
      case '>>':
        return a >> BigInt(shift);
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      default:
        if (b === 0n) throw new Problem('divide-by-zero', token.pos);
        return token.text === '/' ? a / b : a % b;
    }
  }

  private unary(): bigint {
    const token = this.peek();
    if (token?.kind === 'op' && (token.text === '-' || token.text === '~' || token.text === '+')) {
      this.at += 1;
      const value = this.unary();
      return this.wrap(token.text === '-' ? -value : token.text === '~' ? ~value : value);
    }
    if (token?.kind === 'num') {
      this.at += 1;
      return this.wrap(token.value!);
    }
    if (token?.kind === 'lparen') {
      this.at += 1;
      const value = this.level(0);
      if (this.peek()?.kind !== 'rparen') throw new Problem('syntax', this.peek()?.pos ?? this.end);
      this.at += 1;
      return value;
    }
    throw new Problem('syntax', token?.pos ?? this.end);
  }
}

/** The value in the word: wrapped to its bits, as a signed or an unsigned number. */
export function wrapTo(value: bigint, bits: WordSize, signed: boolean): bigint {
  return signed ? BigInt.asIntN(bits, value) : BigInt.asUintN(bits, value);
}

/** Reads and works out the expression. Returns an error value instead of throwing. */
export function evaluateProgrammer(source: string, options: ProgrammerOptions = DEFAULT_PROGRAMMER): ProgrammerResult {
  const text = source.trim();
  if (text === '') return { ok: false, error: 'empty', position: 0 };
  if (text.length > MAX_LENGTH) return { ok: false, error: 'too-long', position: 0 };
  try {
    const wrap = (v: bigint) => wrapTo(v, options.bits, options.signed);
    const value = new Reader(tokenize(text, options.base), wrap, options.bits, text.length).run();
    return { ok: true, value };
  } catch (error) {
    if (error instanceof Problem) return { ok: false, error: error.code, position: error.position };
    throw error;
  }
}

/** Digits in groups of `size` from the right, with a space between groups. */
function grouped(digits: string, size: number): string {
  const out: string[] = [];
  for (let end = digits.length; end > 0; end -= size) out.unshift(digits.slice(Math.max(0, end - size), end));
  return out.join(' ');
}

export interface BaseTexts {
  hex: string;
  dec: string;
  oct: string;
  bin: string;
}

/**
 * The value in all four bases. Decimal is signed when the word is. The others show the word's bits, so -1 in a
 * signed byte is FF in hexadecimal and 1111 1111 in binary.
 */
export function inBases(value: bigint, options: Pick<ProgrammerOptions, 'bits'>): BaseTexts {
  const bits = BigInt.asUintN(options.bits, value);
  return {
    hex: grouped(bits.toString(16).toUpperCase(), 4),
    dec: value.toString(10),
    oct: bits.toString(8),
    bin: grouped(bits.toString(2), 4),
  };
}

/** The value written in one base, without spaces, as the calculator reads it back. */
export function writeIn(value: bigint, options: ProgrammerOptions): string {
  if (options.base === 10) return value.toString(10);
  return BigInt.asUintN(options.bits, value).toString(options.base).toUpperCase();
}
