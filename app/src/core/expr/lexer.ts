// Splits expression text into tokens. One lexer serves every dialect: a LexSpec says which decimal mark, which
// separators, which kinds of names, and which symbols the dialect reads. Pretty symbols people paste from other apps
// (x, /, -, pi, the square root sign, superscript digits) become the plain tokens the parser knows.

import { ExprError } from './errors';

export type TokenKind =
  | 'num' // A number. `text` is the source text and `value` is its value.
  | 'name' // A name: a variable, a constant, a function, a cell reference, or a unit.
  | 'word' // A run of letters that the parser splits into names. Only in 'letters' mode.
  | 'str' // "text". `text` is the content without the quotes.
  | 'col' // [Column name]. `text` is the content without the brackets.
  | 'id' // {column id}. `text` is the content without the braces.
  | 'qname' // 'Quoted name', before "!" in a spreadsheet reference. `text` is the name without the quotes.
  | 'op' // An operator, in its plain form: "+", "-", "*", "/", "^", "<=", and so on.
  | 'lparen'
  | 'rparen'
  | 'sep' // An argument separator.
  | 'colon'
  | 'eof';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly value: number;
  /** The index of the first code unit. */
  readonly start: number;
  /** The index after the last code unit. */
  readonly end: number;
}

export interface LexSpec {
  /** The decimal mark in numbers. */
  decimal: '.' | ',';
  /** The characters that separate arguments, such as "," or ";,". */
  separators: string;
  /**
   * What a name looks like. 'ascii' is a letter or a low line, then letters, digits, or low lines. 'cell' also
   * allows "$", for references such as $A$1. 'letters' is a run of any letters plus trailing digits. The parser
   * splits that run into known names, so "pix" can mean pi times x.
   */
  names: 'ascii' | 'cell' | 'letters';
  /** Every operator the dialect reads, in plain form. Multi-character ones such as "<=" are matched first. */
  operators: readonly string[];
  /** Other spellings of operators, such as the multiplication sign for "*". */
  aliases: Readonly<Record<string, string>>;
  /** Single symbols that read as a name, such as the square root sign for sqrt. */
  words: Readonly<Record<string, string>>;
  /** Superscript digits, such as x squared, read as a power. */
  superscripts: boolean;
  /** "text" with a doubled quote for a quote. */
  strings: boolean;
  /** [Column name] and {column id}. */
  brackets: boolean;
  /** ":" in a range. */
  colon: boolean;
  /** 'Quoted names' with a doubled quote for a quote, as in 'Q1 budget'!A1. */
  quotedNames?: boolean;
  /**
   * Brackets inside brackets, as in Table[[#Headers],[Col]] and [@[Unit price]]. When a "[" opens right after the
   * first one (after an optional "@"), the token runs to the matching "]" and keeps the inner brackets. Otherwise
   * "]]" stays an escaped "]", as in [Unit price [EUR]]].
   */
  nestedBrackets?: boolean;
  /** Error values such as #REF! and #N/A, read as a name that starts with "#". */
  errorLiterals?: boolean;
  /**
   * A mark that groups digits in threes, as in 1,200. Only a mark followed by exactly three digits counts, so a
   * dialect that also separates arguments with this mark reads max(1,200) as one number. Give such a dialect a
   * different separator.
   */
  thousands?: ',' | '.' | '_';
  /** The longest source text. A longer one fails with 'too-long'. */
  maxLength: number;
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUPERSCRIPT_MINUS = '⁻';
const NAME_PATTERNS = {
  ascii: /[A-Za-z_][A-Za-z0-9_]*/y,
  // A dot joins name parts, as in NETWORKDAYS.INTL and STDEV.S. It never ends a name, so "A1." stays a name and a dot.
  cell: /[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/y,
  letters: /\p{L}+\d*/uy,
} as const;
const WHITESPACE = /\s/;
const ERROR_LITERAL = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!|FIELD!|BUSY!)/i;

const escape = (mark: string): string => (/[.\\^$*+?()|[\]{}]/.test(mark) ? `\\${mark}` : mark);

/** Number patterns by decimal mark and grouping mark: 12, 1.5, .5, 1., and any of them with an exponent. */
const numberPatterns = new Map<string, RegExp>();

function numberPattern(decimal: string, thousands: string | undefined): RegExp {
  const key = `${decimal}|${thousands ?? ''}`;
  let pattern = numberPatterns.get(key);
  if (!pattern) {
    const mark = escape(decimal);
    // A grouped number starts with 1 to 9: 0,125 is never a thousand-and-something.
    const grouped = (by: string): string => String.raw`(?:[1-9]\d{0,2}(?:${escape(by)}\d{3})+(?!\d)|\d+)`;
    const whole = thousands === undefined ? String.raw`\d+` : grouped(thousands);
    pattern = new RegExp(String.raw`(?:${whole}${mark}?\d*|${mark}\d+)(?:[eE][+-]?\d+)?`, 'y');
    numberPatterns.set(key, pattern);
  }
  return pattern;
}

/** What a spec means in a form that is quick to use. Built once per spec. */
interface Plan {
  number: RegExp;
  decimal: string;
  thousands: string | undefined;
  name: RegExp;
  names: LexSpec['names'];
  /** One-character operators, including pasted spellings, by the character. */
  single: ReadonlyMap<string, string>;
  /** Two-character operators, such as "<=" and "**". */
  double: ReadonlyMap<string, string>;
  /** The first characters of the two-character operators, so most operators skip the pair lookup. */
  doubleFirst: ReadonlySet<string>;
  words: ReadonlyMap<string, string>;
  separators: ReadonlySet<string>;
}

const plans = new WeakMap<LexSpec, Plan>();

function planOf(spec: LexSpec): Plan {
  let plan = plans.get(spec);
  if (plan === undefined) {
    const spellings = new Map<string, string>(spec.operators.map((op) => [op, op]));
    for (const [pasted, plain] of Object.entries(spec.aliases)) spellings.set(pasted, plain);
    const entries = [...spellings];
    const double = entries.filter(([text]) => text.length === 2);
    plan = {
      number: numberPattern(spec.decimal, spec.thousands),
      decimal: spec.decimal,
      thousands: spec.thousands,
      name: NAME_PATTERNS[spec.names],
      names: spec.names,
      single: new Map(entries.filter(([text]) => text.length === 1)),
      double: new Map(double),
      doubleFirst: new Set(double.map(([text]) => text[0])),
      words: new Map(Object.entries(spec.words)),
      separators: new Set(spec.separators),
    };
    plans.set(spec, plan);
  }
  return plan;
}

function matchAt(pattern: RegExp, source: string, at: number): string | null {
  pattern.lastIndex = at;
  return pattern.exec(source)?.[0] ?? null;
}

/** Number text with the decimal mark written as a period and grouping marks removed. */
export function canonicalNumberText(text: string, decimal: string, thousands?: string): string {
  const plain = thousands === undefined ? text : text.replaceAll(thousands, '');
  return decimal === '.' ? plain : plain.replace(decimal, '.');
}

/** The value of number text read with a decimal mark and, optionally, a grouping mark. */
export function numberValue(text: string, decimal: string, thousands?: string): number {
  return Number(canonicalNumberText(text, decimal, thousands));
}

function token(kind: TokenKind, text: string, start: number, end: number, value = 0): Token {
  return { kind, text, value, start, end };
}

/** Reads text up to the closing character. A doubled closing character stands for one, except for "}". */
function readDelimited(source: string, at: number, close: string): { text: string; end: number } {
  let text = '';
  for (let i = at + 1; i < source.length; i += 1) {
    if (source[i] !== close) {
      text += source[i];
    } else if (source[i + 1] === close && close !== '}') {
      text += close;
      i += 1;
    } else {
      return { text, end: i + 1 };
    }
  }
  throw new ExprError(close === '"' ? 'unclosed-quote' : 'unclosed-bracket', at, close, { length: 1 });
}

const isDigit = (code: number): boolean => code >= 48 && code <= 57;

class Lexer {
  readonly tokens: Token[] = [];
  private at = 0;
  private readonly plan: Plan;

  constructor(
    private readonly source: string,
    private readonly spec: LexSpec,
  ) {
    this.plan = planOf(spec);
  }

  run(): Token[] {
    const { source } = this;
    if (source.length > this.spec.maxLength) throw new ExprError('too-long', 0, undefined, { length: source.length });
    while (this.at < source.length) {
      const code = source.charCodeAt(this.at);
      const blank = code === 32 || (code >= 9 && code <= 13) || (code > 127 && WHITESPACE.test(source[this.at]));
      if (blank) this.at += 1;
      else this.readOne(code);
    }
    this.tokens.push(token('eof', '', source.length, source.length));
    return this.tokens;
  }

  private push(next: Token): void {
    this.tokens.push(next);
    this.at = next.end;
  }

  /** True when a name can start with this character. The pattern makes the final choice. */
  private startsName(code: number): boolean {
    const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
    if (letter) return true;
    if (this.plan.names === 'cell') return code === 36;
    return this.plan.names === 'letters' && code > 127;
  }

  private readOne(code: number): void {
    const { source, plan } = this;
    const char = source[this.at];
    const numberStart = isDigit(code) || (char === plan.decimal && isDigit(source.charCodeAt(this.at + 1)));
    if (numberStart) {
      const digits = matchAt(plan.number, source, this.at);
      if (digits !== null) return this.readNumber(digits);
    }
    if (this.startsName(code)) {
      const name = matchAt(plan.name, source, this.at);
      if (name !== null) {
        return this.push(token(plan.names === 'letters' ? 'word' : 'name', name, this.at, this.at + name.length));
      }
    }
    const word = plan.words.get(char);
    if (word !== undefined) return this.push(token('name', word, this.at, this.at + 1));
    if (this.spec.superscripts && (SUPERSCRIPT_DIGITS.includes(char) || char === SUPERSCRIPT_MINUS)) {
      return this.readSuperscript();
    }
    if (char === '#' && this.spec.errorLiterals === true) {
      const literal = ERROR_LITERAL.exec(source.slice(this.at, this.at + 8));
      if (literal !== null)
        return this.push(token('name', literal[0].toUpperCase(), this.at, this.at + literal[0].length));
    }
    const operator = this.operatorAt(char);
    if (operator !== null) return this.push(operator);
    const other = this.punctuation(char);
    if (other !== null) return this.push(other);
    throw new ExprError('bad-character', this.at, char, { length: 1 });
  }

  private readNumber(text: string): void {
    const start = this.at;
    const value = numberValue(text, this.plan.decimal, this.plan.thousands);
    if (!Number.isFinite(value)) throw new ExprError('bad-number', start, text, { length: text.length });
    this.push(token('num', text, start, start + text.length, value));
  }

  /** A run such as the superscript 10 or minus 1 becomes "^" and a number, or "^", "-", and a number. */
  private readSuperscript(): void {
    const start = this.at;
    let end = start;
    const negative = this.source[end] === SUPERSCRIPT_MINUS;
    if (negative) end += 1;
    let digits = '';
    while (end < this.source.length && SUPERSCRIPT_DIGITS.includes(this.source[end])) {
      digits += SUPERSCRIPT_DIGITS.indexOf(this.source[end]);
      end += 1;
    }
    if (digits === '') throw new ExprError('bad-character', start, this.source[start], { length: 1 });
    this.tokens.push(token('op', '^', start, start + 1));
    if (negative) this.tokens.push(token('op', '-', start, start + 1));
    this.push(token('num', digits, negative ? start + 1 : start, end, Number(digits)));
  }

  /** The longest operator that starts here: two characters first, then one. */
  private operatorAt(char: string): Token | null {
    const { at, plan } = this;
    const pair = plan.doubleFirst.has(char) ? plan.double.get(this.source.slice(at, at + 2)) : undefined;
    if (pair !== undefined) return token('op', pair, at, at + 2);
    const one = plan.single.get(char);
    return one === undefined ? null : token('op', one, at, at + 1);
  }

  private punctuation(char: string): Token | null {
    const { at, spec } = this;
    if (char === '(') return token('lparen', char, at, at + 1);
    if (char === ')') return token('rparen', char, at, at + 1);
    if (this.plan.separators.has(char)) return token('sep', char, at, at + 1);
    if (spec.colon && char === ':') return token('colon', char, at, at + 1);
    if (spec.strings && char === '"') return this.delimited('str', '"');
    if (spec.brackets && char === '[') return this.bracket();
    if (spec.quotedNames === true && char === "'") return this.delimited('qname', "'");
    if (spec.brackets && char === '{') return this.delimited('id', '}');
    return null;
  }

  /** [Column name], or with nested brackets the whole of Table[[#Headers],[Col]] after the table's name. */
  private bracket(): Token {
    const { source, at } = this;
    const nested = this.spec.nestedBrackets === true && /^\[\s*@?\s*\[/.test(source.slice(at, at + 40));
    if (!nested) return this.delimited('col', ']');
    let depth = 0;
    for (let i = at; i < source.length; i += 1) {
      // An apostrophe escapes the next character, as in [Q'#] for a column named "Q#".
      if (source[i] === "'") i += 1;
      else if (source[i] === '[') depth += 1;
      else if (source[i] === ']') {
        depth -= 1;
        if (depth === 0) return token('col', source.slice(at + 1, i), at, i + 1);
      }
    }
    throw new ExprError('unclosed-bracket', at, ']', { length: 1 });
  }

  private delimited(kind: TokenKind, close: string): Token {
    const { text, end } = readDelimited(this.source, this.at, close);
    return token(kind, text, this.at, end);
  }
}

/** Splits `source` into tokens, ending with an 'eof' token. Throws an ExprError at text it cannot read. */
export function tokenize(source: string, spec: LexSpec): Token[] {
  return new Lexer(source, spec).run();
}
