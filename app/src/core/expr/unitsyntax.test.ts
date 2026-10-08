import { describe, expect, it } from 'vitest';
import { sameTree, type Node } from './ast';
import { ExprError } from './errors';
import { GENERAL } from './general';
import { parse } from './parser';
import { formatExpression } from './print';
import { WITH_UNITS } from './testing';

/** The tree as short text: quantities as 5[km^1], conversions as value in [unit]. */
function show(node: Node): string {
  switch (node.type) {
    case 'quantity':
      return `${node.value.text}[${node.unit.factors.map((f) => `${f.name}^${f.power}`).join(' ')}]`;
    case 'convert':
      return `${show(node.value)} in [${node.unit.factors.map((f) => `${f.name}^${f.power}`).join(' ')}]`;
    case 'binary':
      return `(${show(node.left)} ${node.op} ${show(node.right)})`;
    case 'unary':
      return `(${node.op}${show(node.arg)})`;
    case 'postfix':
      return `(${show(node.arg)}${node.op})`;
    case 'call':
      return `${node.name}[${node.args.map(show).join(' ')}]`;
    case 'num':
      return node.text;
    case 'name':
      return node.name;
    default:
      return node.type;
  }
}

const read = (source: string): string => show(parse(source, WITH_UNITS));

function failure(source: string): ExprError {
  try {
    parse(source, WITH_UNITS);
  } catch (error) {
    if (error instanceof ExprError) return error;
    throw error;
  }
  throw new Error(`${source} should not parse`);
}

describe('a number with a unit', () => {
  it('reads one unit, with or without a space', () => {
    expect(read('5 km')).toBe('5[km^1]');
    expect(read('5km')).toBe('5[km^1]');
    expect(read('2.5 h')).toBe('2.5[h^1]');
  });

  it('reads powers and ratios of units', () => {
    expect(read('9.8 m/s^2')).toBe('9.8[m^1 s^-2]');
    expect(read('60 mi/h')).toBe('60[mi^1 h^-1]');
    expect(read('3 kg*m/s^2')).toBe('3[kg^1 m^1 s^-2]');
    expect(read('2 s^-1')).toBe('2[s^-1]');
    expect(read('4 km^2')).toBe('4[km^2]');
    expect(read('5 m²')).toBe('5[m^2]');
    expect(read('1 kg/m/s')).toBe('1[kg^1 m^-1 s^-1]');
  });

  it('reads units of several words and units with a degree sign', () => {
    expect(read('8 fl oz')).toBe('8[fl oz^1]');
    expect(read('2 light year')).toBe('2[light year^1]');
    expect(read('72 °F')).toBe('72[°F^1]');
    expect(read('72°F')).toBe('72[°F^1]');
  });

  it('does not take a division or a product that is not followed by a unit', () => {
    expect(read('5 m / 2 s')).toBe('(5[m^1] / 2[s^1])');
    expect(read('5 m * 3')).toBe('(5[m^1] * 3)');
    expect(read('5 m * x')).toBe('(5[m^1] * x)');
  });

  it('leaves a degree sign alone when no unit follows', () => {
    expect(read('sin(30°)')).toBe('sin[(30°)]');
    expect(read('30° + 1')).toBe('((30°) + 1)');
  });

  it('leaves names that are not units for implicit products', () => {
    expect(read('2 x')).toBe('(2 * x)');
    expect(read('3 pi')).toBe('(3 * pi)');
  });

  it('reads nothing special without units in the dialect', () => {
    expect(() => parse('5 km', GENERAL)).not.toThrow();
    expect(parse('5 km', GENERAL).type).toBe('binary');
  });
});

describe('converting', () => {
  it('reads the words in, to, as, and into, and the arrows', () => {
    for (const word of ['in', 'to', 'as', 'into', 'IN', 'To']) {
      expect(read(`5 mi ${word} km`)).toBe('5[mi^1] in [km^1]');
    }
    expect(read('5 mi -> km')).toBe('5[mi^1] in [km^1]');
    expect(read('5 mi → km')).toBe('5[mi^1] in [km^1]');
  });

  it('knows in is both inches and the word', () => {
    expect(read('5 in in cm')).toBe('5[in^1] in [cm^1]');
    expect(read('5 in')).toBe('5[in^1]');
    expect(read('5 in to cm')).toBe('5[in^1] in [cm^1]');
    expect(read('x in km')).toBe('x in [km^1]');
  });

  it('applies to the whole expression and binds loosest', () => {
    expect(read('1 km + 300 m in m')).toBe('(1[km^1] + 300[m^1]) in [m^1]');
    expect(read('2 * 3 km in m')).toBe('(2 * 3[km^1]) in [m^1]');
    expect(read('(1 + 2) km in m')).toBe('((1 + 2) * km) in [m^1]');
  });

  it('converts to a ratio or a power of units', () => {
    expect(read('60 mph in km/h')).toBe('60[mph^1] in [km^1 h^-1]');
    expect(read('2 ft^2 in m^2')).toBe('2[ft^2] in [m^2]');
  });

  it('says what was missing after the word', () => {
    expect(failure('5 mi in')).toMatchObject({ code: 'unexpected-end' });
    expect(failure('5 mi in banana')).toMatchObject({ code: 'unknown-unit', position: 8, detail: 'banana' });
    expect(failure('5 mi to 3')).toMatchObject({ code: 'unknown-unit', position: 8 });
  });
});

describe('writing units', () => {
  it.each([
    '5 km',
    '9.8 m/s^2',
    '3 kg*m/s^2',
    '2 s^-1',
    '8 fl oz',
    '72 °F',
    '5 mi in km',
    '60 mph in km/h',
    '5 in in cm',
  ])('reads %s back as the same tree', (source) => {
    const tree = parse(source, WITH_UNITS);
    const written = formatExpression(tree);
    expect(sameTree(parse(written, WITH_UNITS), tree), `${source} -> ${written}`).toBe(true);
  });

  it('puts brackets around a conversion that is part of something larger', () => {
    expect(formatExpression(parse('(5 mi in km) + 1', WITH_UNITS))).toBe('(5 mi in km)+1');
    expect(formatExpression(parse('(5 km)^2', WITH_UNITS))).toBe('(5 km)^2');
  });
});
