// Reading units: the "km" in 5 km, the "m/s^2" in 9.8 m/s^2, and the target of 5 mi in km. A unit expression is
// one or more unit names joined by * or /, each with an optional whole-number power. A name may be several words
// ("fl oz", "light year"), so the longest run of names that the dialect knows as one unit wins. A / or * only joins
// another unit when a unit follows it, so in 5 m / 2 s the division is not part of the unit.

import type { UnitExpr, UnitFactor } from './ast';
import type { UnitSpec } from './dialect';
import { ExprError } from './errors';
import type { Token } from './lexer';

/** The reading position of a parser, as far as unit syntax needs it. */
export interface Cursor {
  /** The token `offset` places ahead of the next one. */
  peek(offset?: number): Token;
  next(): Token;
}

const CONVERT_WORDS: ReadonlySet<string> = new Set(['in', 'to', 'as', 'into']);

/** True for the words and signs that convert a value to another unit. */
export function isConvertToken(token: Token): boolean {
  if (token.kind === 'op') return token.text === '->';
  return token.kind === 'name' && CONVERT_WORDS.has(token.text.toLowerCase());
}

/** The unit name that starts `offset` tokens ahead, with how many tokens it uses, or null. */
function unitNameAt(cursor: Cursor, units: UnitSpec, offset: number): { name: string; tokens: number } | null {
  const first = cursor.peek(offset);
  if (first.kind === 'op' && first.text === '°') {
    const second = cursor.peek(offset + 1);
    const name = `°${second.text}`;
    const joined = second.kind === 'name' && second.start === first.end && units.has(name);
    return joined ? { name, tokens: 2 } : null;
  }
  if (first.kind !== 'name') return null;
  const words = [first.text];
  for (let i = 1; i < 3; i += 1) {
    const more = cursor.peek(offset + i);
    if (more.kind !== 'name') break;
    words.push(more.text);
  }
  for (let count = words.length; count >= 1; count -= 1) {
    const name = words.slice(0, count).join(' ');
    if (units.has(name)) return { name, tokens: count };
  }
  return null;
}

/** True when a unit name starts at the cursor. */
export function startsUnit(cursor: Cursor, units: UnitSpec): boolean {
  return unitNameAt(cursor, units, 0) !== null;
}

/** One unit and its power: m, s^2, or s^-1. The cursor is at the unit's name. */
function readFactor(cursor: Cursor, units: UnitSpec): { factor: UnitFactor; end: number } {
  const found = unitNameAt(cursor, units, 0);
  if (found === null) throw new ExprError('unknown-unit', cursor.peek().start);
  const pos = cursor.peek().start;
  let end = pos;
  for (let i = 0; i < found.tokens; i += 1) end = cursor.next().end;
  let power = 1;
  const caret = cursor.peek();
  if (caret.kind === 'op' && caret.text === '^') {
    const negative = cursor.peek(1).kind === 'op' && cursor.peek(1).text === '-';
    const digits = cursor.peek(negative ? 2 : 1);
    if (digits.kind === 'num' && Number.isInteger(digits.value)) {
      cursor.next();
      if (negative) cursor.next();
      end = cursor.next().end;
      power = negative ? -digits.value : digits.value;
    }
  }
  return { factor: { name: found.name, power, pos }, end };
}

/** Reads a unit expression at the cursor, or returns null when no unit starts here. */
export function readUnitExpr(cursor: Cursor, units: UnitSpec): UnitExpr | null {
  if (!startsUnit(cursor, units)) return null;
  const start = cursor.peek().start;
  const first = readFactor(cursor, units);
  const factors: UnitFactor[] = [first.factor];
  let end = first.end;
  for (;;) {
    const sign = cursor.peek();
    const joins = sign.kind === 'op' && (sign.text === '*' || sign.text === '/');
    if (!joins || unitNameAt(cursor, units, 1) === null) break;
    cursor.next();
    const next = readFactor(cursor, units);
    factors.push(sign.text === '/' ? { ...next.factor, power: -next.factor.power } : next.factor);
    end = next.end;
  }
  return { start, end, factors };
}

/** Writes a unit expression as text that reads back the same: kg*m/s^2, s^-1, or fl oz. */
export function formatUnit(unit: UnitExpr): string {
  return unit.factors
    .map((f, index) => {
      const power = index > 0 && f.power < 0 ? -f.power : f.power;
      const body = power === 1 ? f.name : `${f.name}^${power}`;
      if (index === 0) return body;
      return f.power < 0 ? `/${body}` : `*${body}`;
    })
    .join('');
}
