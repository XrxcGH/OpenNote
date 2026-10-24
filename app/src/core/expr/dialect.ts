// A dialect says which part of the shared grammar a host reads. The calculator, the grapher, and the table formulas
// are three dialects of one grammar: the same tokenizer, the same precedence, the same tree. They differ in what
// the text may contain (a decimal comma, cell references, strings), in whether side-by-side things multiply, and in
// how a function is written.

import type { LexSpec } from './lexer';

export interface FunctionInfo {
  /** The canonical name that the call node carries, such as "asin" for "arcsin". */
  name: string;
  /** The fewest and most arguments. */
  min: number;
  max: number;
  /** The function that `name^-1` means, as in sin^-1(x), for dialects that write powers on function names. */
  inverse?: string;
}

/** Which words are units, for dialects that read 5 km and 5 km in mi. */
export interface UnitSpec {
  /** True when the text is a unit's symbol or name, such as "km", "mph", "fl oz", or the degree sign with "C". */
  has(name: string): boolean;
}

export interface Dialect {
  lex: LexSpec;
  /** The binary operators the grammar reads. Includes "mod" when the word "mod" works as an operator. */
  infix: ReadonlySet<string>;
  /** The prefix operators: "-", "+", and the square root sign. */
  prefix: ReadonlySet<string>;
  /** The postfix operators: "!", "%", and the degree sign. */
  postfix: ReadonlySet<string>;
  /**
   * What side-by-side operands do. 'none' is an error. 'free' multiplies them, as in 2x and (a+1)(a-1).
   * 'strict' multiplies them too, except for two numbers in a row, which is an error because 2 3 is likely a slip.
   */
  implicit: 'none' | 'strict' | 'free';
  /** Looks up a function by the name as typed. Returns undefined for a name that is not a function. */
  functions?: (name: string) => FunctionInfo | undefined;
  /**
   * How a known function is called. 'paren' needs brackets, so `sin 30` is an error. 'bare' also takes `sin x`,
   * `sin 2x`, `sin^2(x)` and, where the function has an inverse, `sin^-1(x)`.
   */
  calls: 'paren' | 'bare';
  /** What `name(` means when the name is not a known function: a call to an unknown function, or a product. */
  unknownCalls: 'call' | 'multiply';
  /** The name that a call to an unknown function carries. Default: the name as typed. */
  callName?: (text: string) => string;
  /** Whether the parser rejects a call with too few or too many arguments. */
  checkArity: boolean;
  /** The names that a run of letters may be split into. Needs `lex.names` set to 'letters'. */
  split?: ReadonlySet<string>;
  /** Whether A1, $A$1, A1:B5, and B:B read as cells and ranges. */
  cells: boolean;
  /** Words that stand for a value, matched without regard to case: TRUE, FALSE, PI. */
  keywords?: Readonly<Record<string, boolean | number>>;
  /** When true, a bare name that is not a cell, a keyword, or a call is an error instead of a variable. */
  strictNames: boolean;
  /** Whether `name = expression` and `name(a, b) = expression` are statements. Needs "=" to not be an operator. */
  definitions: boolean;
  /**
   * When set, a number may be followed by a unit (5 km, 9.8 m/s^2), and `in`, `to`, `as`, `into`, or `->` converts a
   * value to another unit (5 mi in km). Without it the same text is a mistake or a product of names.
   */
  units?: UnitSpec;
  /** The most nested groups, signs, and powers. */
  maxDepth: number;
}

/** The lexer settings the dialects share: the usual operators and the pretty symbols people paste. */
export const BASE_LEX: LexSpec = {
  decimal: '.',
  separators: ',',
  names: 'ascii',
  operators: ['+', '-', '*', '/', '^', '!', '%', '°'],
  aliases: {
    '×': '*',
    '·': '*',
    '⋅': '*',
    '∙': '*',
    '∗': '*',
    '÷': '/',
    '−': '-',
    '–': '-',
    '**': '^',
  },
  words: {},
  superscripts: true,
  strings: false,
  brackets: false,
  colon: false,
  maxLength: Infinity,
};

/** A set from a list, for writing a dialect's operator tables compactly. */
export function setOf(...items: string[]): ReadonlySet<string> {
  return new Set(items);
}
