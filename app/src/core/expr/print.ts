// Writes a tree back as expression text with only the brackets it needs. Parsing the text again gives the same tree
// (up to positions), which the property tests check for every dialect. The text uses the plain operator forms, so
// pasted symbols such as the multiplication sign come out as "*".

import type { BinaryNode, Node } from './ast';
import { lettersFromColumn } from './refs';
import { formatUnit } from './unitsyntax';

export interface PrintOptions {
  /** The decimal mark in numbers. Default ".". */
  decimal?: '.' | ',';
  /** The argument separator. Default ",". */
  separator?: ',' | ';';
  /** Put spaces around + - and comparisons, and after separators. */
  spaced?: boolean;
}

// How tightly each kind of node holds together. A child that holds less tightly than its place needs brackets.
const CONVERT = 5;
const COMPARE = 10;
const JOIN = 20;
const SUM = 30;
const PRODUCT = 40;
const SIGN = 50;
const POWER = 60;
const POSTFIX = 70;
const ATOM = 100;

const BINARY_POWER: Readonly<Record<BinaryNode['op'], number>> = {
  '=': COMPARE,
  '<>': COMPARE,
  '<': COMPARE,
  '>': COMPARE,
  '<=': COMPARE,
  '>=': COMPARE,
  '&': JOIN,
  '+': SUM,
  '-': SUM,
  '*': PRODUCT,
  '/': PRODUCT,
  mod: PRODUCT,
  '^': POWER,
};

function isNegativeNumber(node: Node): boolean {
  return node.type === 'num' && (node.value < 0 || Object.is(node.value, -0));
}

function power(node: Node): number {
  switch (node.type) {
    case 'binary':
      return BINARY_POWER[node.op];
    case 'unary':
      return SIGN;
    case 'postfix':
      return POSTFIX;
    case 'convert':
      return CONVERT;
    case 'quantity':
      return SIGN;
    case 'num':
      return isNegativeNumber(node) ? SIGN : ATOM;
    default:
      return ATOM;
  }
}

/** Number text for a value made by the engine, which has no source text: as short as it can be and still exact. */
export function numberText(value: number): string {
  return String(value);
}

class Printer {
  constructor(private readonly options: PrintOptions) {}

  node(node: Node): string {
    switch (node.type) {
      case 'num':
        return this.number(node);
      case 'str':
        return `"${node.value.replaceAll('"', '""')}"`;
      case 'bool':
        return node.value ? 'TRUE' : 'FALSE';
      case 'name':
        return node.name;
      case 'col':
        return node.by === 'id' ? `{${node.key}}` : `[${node.key.replaceAll(']', ']]')}]`;
      case 'cell':
        return `${lettersFromColumn(node.col)}${node.row + 1}`;
      case 'range':
        return this.range(node);
      case 'unary':
        return this.unary(node);
      case 'postfix':
        return `${this.child(node.arg, POSTFIX)}${node.op}`;
      case 'binary':
        return this.binary(node);
      case 'call':
        return `${node.name}(${node.args.map((arg) => this.node(arg)).join(this.separator())})`;
      case 'quantity':
        return `${this.number(node.value)} ${formatUnit(node.unit)}`;
      case 'convert':
        return `${this.child(node.value, CONVERT)} in ${formatUnit(node.unit)}`;
    }
  }

  private separator(): string {
    const mark = this.options.separator ?? ',';
    return this.options.spaced === true ? `${mark} ` : mark;
  }

  private number(node: Extract<Node, { type: 'num' }>): string {
    const text = node.text.length > 0 && !Number.isNaN(Number(node.text)) ? node.text : numberText(node.value);
    const signed = node.value < 0 && !text.startsWith('-') ? `-${text}` : text;
    return this.options.decimal === ',' ? signed.replace('.', ',') : signed;
  }

  private range(node: Extract<Node, { type: 'range' }>): string {
    const first = lettersFromColumn(node.col1);
    const second = lettersFromColumn(node.col2);
    if (node.row2 === Infinity) return `${first}:${second}`;
    return `${first}${node.row1 + 1}:${second}${node.row2 + 1}`;
  }

  /** The child text, in brackets when the child holds together less tightly than `needed`. */
  private child(node: Node, needed: number): string {
    const text = this.node(node);
    return power(node) < needed ? `(${text})` : text;
  }

  private unary(node: Extract<Node, { type: 'unary' }>): string {
    return `${node.op}${this.child(node.arg, SIGN)}`;
  }

  private binary(node: BinaryNode): string {
    const own = BINARY_POWER[node.op];
    const rightAssociative = node.op === '^';
    // A left-associative operator brackets an equal-strength child on the right: a-(b-c). A power does the opposite.
    if (node.implicit === true && node.op === '*') {
      // Side by side, the right operand cannot start with a sign, which would read as a subtraction.
      return this.juxtapose(node, this.child(node.left, own), this.child(node.right, POWER));
    }
    const left = this.child(node.left, rightAssociative ? own + 1 : own);
    const right = this.child(node.right, rightAssociative ? SIGN : own + 1);
    return `${left}${this.operator(node.op)}${right}`;
  }

  private operator(op: BinaryNode['op']): string {
    if (op === 'mod') return ' mod ';
    const spaced = this.options.spaced === true && op !== '*' && op !== '/' && op !== '^';
    return spaced ? ` ${op} ` : op;
  }

  /**
   * Writes a product that was typed without a sign: 2x, 2(x+1), x y. A space keeps names apart, and a right side that
   * starts with a digit goes in brackets, since two numbers side by side are not always allowed.
   */
  private juxtapose(node: BinaryNode, left: string, right: string): string {
    if (/^[\d.]/.test(right)) return `${left}(${right})`;
    const exponentRisk = /^[eE]/.test(right);
    const tight = right.startsWith('(') || (node.left.type === 'num' && /^[A-Za-z]/.test(right) && !exponentRisk);
    return tight ? `${left}${right}` : `${left} ${right}`;
  }
}

/** Writes `node` as expression text. */
export function formatExpression(node: Node, options: PrintOptions = {}): string {
  return new Printer(options).node(node);
}
