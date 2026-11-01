import './text';
import { describe, expect, it } from 'vitest';
import {
  CPP_TYPES,
  FLOAT_FORMATS,
  characters,
  decodeFloat,
  decodeInt,
  dyadicToDecimal,
  encodeDecimal,
  encodeInt,
  fromBase,
  intRange,
  neighbour,
  parseDecimal,
  parseInteger,
  rat,
  ratToSci,
  toBase,
  wrapInt,
} from './numrep';

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(String((r as unknown as { problem: string }).problem));
  return r as Extract<T, { ok: true }>;
};
const hex = (b: bigint, digits: number) => `0x${b.toString(16).toUpperCase().padStart(digits, '0')}`;
const { half, single, double } = FLOAT_FORMATS;

/** Reference: read the bits a real Float32Array or Float64Array stores. */
const ref32 = (x: number): bigint => BigInt(new Uint32Array(new Float32Array([x]).buffer)[0]!);
const ref64 = (x: number): bigint => new BigUint64Array(new Float64Array([x]).buffer)[0]!;

describe('integers', () => {
  it("-5 in 8-bit two's complement is 11111011", () => {
    expect(ok(encodeInt(-5n, 8, 'twos')).bits).toBe('11111011');
    expect(ok(decodeInt('11111011', 'twos')).value).toBe(-5n);
  });
  it('the other schemes encode -5 as their definitions say', () => {
    expect(ok(encodeInt(-5n, 8, 'ones')).bits).toBe('11111010');
    expect(ok(encodeInt(-5n, 8, 'signmag')).bits).toBe('10000101');
    expect(ok(encodeInt(-5n, 8, 'excess', 127n)).bits).toBe('01111010');
    expect(ok(decodeInt('11111010', 'ones')).value).toBe(-5n);
    expect(ok(decodeInt('10000101', 'signmag')).value).toBe(-5n);
    expect(ok(decodeInt('01111010', 'excess', 127n)).value).toBe(-5n);
  });
  it('ranges and overflow', () => {
    expect(intRange(8, 'twos')).toEqual({ min: -128n, max: 127n });
    expect(intRange(8, 'ones')).toEqual({ min: -127n, max: 127n });
    expect(encodeInt(128n, 8, 'twos')).toEqual({ ok: false, problem: 'outOfRange' });
    expect(encodeInt(-1n, 8, 'unsigned')).toEqual({ ok: false, problem: 'outOfRange' });
    expect(wrapInt(128n, 8, true)).toBe(-128n);
    expect(wrapInt(256n, 8, false)).toBe(0n);
    expect(wrapInt(-1n, 8, false)).toBe(255n);
    expect(wrapInt(2n ** 31n, 32, true)).toBe(-(2n ** 31n));
  });
  it('round trips every 6-bit pattern in every scheme', () => {
    for (const scheme of ['unsigned', 'twos', 'ones', 'signmag', 'excess'] as const) {
      for (let p = 0; p < 64; p++) {
        const bits = p.toString(2).padStart(6, '0');
        const v = ok(decodeInt(bits, scheme, 31n)).value;
        if (scheme === 'ones' && bits === '111111') continue; // negative zero
        if (scheme === 'signmag' && bits === '100000') continue;
        expect(ok(encodeInt(v, 6, scheme, 31n)).bits).toBe(bits);
      }
    }
  });
  it('rejects bad widths and bit text', () => {
    expect(encodeInt(1n, 0, 'twos')).toEqual({ ok: false, problem: 'widthRange' });
    expect(encodeInt(1n, 200, 'twos')).toEqual({ ok: false, problem: 'widthRange' });
    expect(decodeInt('10201', 'twos')).toEqual({ ok: false, problem: 'notBits' });
    expect(decodeInt('', 'twos')).toEqual({ ok: false, problem: 'notBits' });
  });
  it('parses prefixes', () => {
    expect(parseInteger('0xFF')).toBe(255n);
    expect(parseInteger('-0b101')).toBe(-5n);
    expect(parseInteger('1_000')).toBe(1000n);
    expect(parseInteger('12x')).toBeNull();
    expect(parseInteger('1e3')).toBeNull();
  });
});

describe('base conversion', () => {
  it('shows division and remainder steps', () => {
    const r = ok(toBase(156n, 2));
    expect(r.text).toBe('10011100');
    expect(r.steps).toHaveLength(8);
    expect(r.steps[0]!.latex).toContain('156');
    expect(ok(toBase(255n, 16)).text).toBe('FF');
    expect(ok(toBase(-10n, 2)).text).toBe('-1010');
    expect(ok(toBase(0n, 7)).text).toBe('0');
    expect(toBase(5n, 1)).toEqual({ ok: false, problem: 'baseRange' });
  });
  it('parses digits in a base and refuses digits that are too big', () => {
    expect(ok(fromBase('ff', 16)).value).toBe(255n);
    expect(ok(fromBase('-z', 36)).value).toBe(-35n);
    expect(fromBase('12', 2)).toEqual({ ok: false, problem: 'digitTooBig' });
    expect(fromBase('1.5', 10)).toEqual({ ok: false, problem: 'notDigits' });
    const huge = '9'.repeat(60);
    expect(ok(fromBase(huge, 10)).value.toString()).toBe(huge);
  });
  it('C++ type table agrees with its widths', () => {
    for (const t of CPP_TYPES) {
      if (t.name === 'bool') continue;
      const r = intRange(t.bits, t.signed ? 'twos' : 'unsigned');
      expect(r).toEqual({ min: t.min, max: t.max });
    }
  });
});

describe('IEEE 754 encode', () => {
  it('0.1 as single is 0x3DCCCCCD with value 0.100000001490116...', () => {
    const e = ok(encodeDecimal('0.1', single)).encoding;
    expect(hex(e.bits, 8)).toBe('0x3DCCCCCD');
    expect(dyadicToDecimal(e.stored!)).toBe('0.100000001490116119384765625');
    expect(e.rounded).toBe(true);
    expect(e.error.startsWith('1.4901')).toBe(true);
  });
  it('1.0 single and -2.5 double', () => {
    expect(hex(ok(encodeDecimal('1.0', single)).encoding.bits, 8)).toBe('0x3F800000');
    expect(hex(ok(encodeDecimal('-2.5', double)).encoding.bits, 16)).toBe('0xC004000000000000');
  });
  it('65504 as half is 0x7BFF, and 65520 rounds to infinity', () => {
    expect(hex(ok(encodeDecimal('65504', half)).encoding.bits, 4)).toBe('0x7BFF');
    const o = ok(encodeDecimal('65520', half)).encoding;
    expect(hex(o.bits, 4)).toBe('0x7C00');
    expect(o.overflow).toBe(true);
  });
  it('agrees with the machine for many values', () => {
    const values = [
      '0.1',
      '0.2',
      '0.3',
      '3.14159265358979',
      '1e10',
      '1e-10',
      '123456789',
      '-0.000123',
      '5e-324',
      '1.7976931348623157e308',
      '2.2250738585072014e-308',
      '16777217',
    ];
    for (const v of values) {
      expect(ok(encodeDecimal(v, double)).encoding.bits).toBe(ref64(Number(v)));
    }
    for (const v of [
      '0.1',
      '0.2',
      '0.3',
      '1e10',
      '1e-10',
      '123456789',
      '-0.000123',
      '1e-45',
      '3.4028235e38',
      '16777217',
      '1.17549435e-38',
    ]) {
      expect(ok(encodeDecimal(v, single)).encoding.bits).toBe(ref32(Number(v)));
    }
  });
  it('rounds ties to even', () => {
    // 16777217 = 2^24 + 1 is halfway between 16777216 and 16777218 in single: ties to even mantissa
    expect(dyadicToDecimal(ok(encodeDecimal('16777217', single)).encoding.stored!)).toBe('16777216');
    expect(dyadicToDecimal(ok(encodeDecimal('16777219', single)).encoding.stored!)).toBe('16777220');
  });
  it('negative zero, infinity, NaN and garbage', () => {
    expect(hex(ok(encodeDecimal('-0', single)).encoding.bits, 8)).toBe('0x80000000');
    expect(hex(ok(encodeDecimal('-inf', single)).encoding.bits, 8)).toBe('0xFF800000');
    expect(hex(ok(encodeDecimal('nan', single)).encoding.bits, 8)).toBe('0x7FC00000');
    expect(encodeDecimal('abc', single)).toEqual({ ok: false, problem: 'notNumber' });
    expect(encodeDecimal('', single)).toEqual({ ok: false, problem: 'notNumber' });
    expect(hex(ok(encodeDecimal('1e39', single)).encoding.bits, 8)).toBe('0x7F800000');
    expect(hex(ok(encodeDecimal('1e-60', single)).encoding.bits, 8)).toBe('0x00000000');
  });
});

describe('IEEE 754 decode', () => {
  it('0x7F7FFFFF is 3.4028235e38 and 0x00000001 is 1.4012985e-45', () => {
    const big = ok(decodeFloat(0x7f7fffffn, single)).decoded;
    expect(big.cls).toBe('normal');
    expect(big.shortest).toBe('3.4028235e38');
    expect(big.decimal.startsWith('340282346638528859811704183484516925440')).toBe(true);
    const tiny = ok(decodeFloat(1n, single)).decoded;
    expect(tiny.cls).toBe('subnormal');
    expect(tiny.shortest).toBe('1e-45');
    expect(ratToSci(tiny.exact!, 8)).toBe('1.4012985e-45');
  });
  it('classifies the special patterns', () => {
    expect(ok(decodeFloat(0n, single)).decoded.cls).toBe('zero');
    expect(ok(decodeFloat(0x80000000n, single)).decoded.decimal).toBe('-0');
    expect(ok(decodeFloat(0x7f800000n, single)).decoded.decimal).toBe('infinity');
    expect(ok(decodeFloat(0xff800000n, single)).decoded.decimal).toBe('-infinity');
    expect(ok(decodeFloat(0x7fc00000n, single)).decoded.cls).toBe('nan');
    expect(decodeFloat(1n << 32n, single)).toEqual({ ok: false, problem: 'bitsRange' });
  });
  it('decodes exactly like the machine for random patterns', () => {
    let seed = 12345;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    for (let i = 0; i < 300; i++) {
      const b = BigInt(next());
      const d = ok(decodeFloat(b, single)).decoded;
      const x = new Float32Array(new Uint32Array([Number(b)]).buffer)[0]!;
      if (Number.isNaN(x)) {
        expect(d.cls).toBe('nan');
        continue;
      }
      if (!Number.isFinite(x)) continue;
      expect(Number(d.decimal)).toBe(x);
      expect(ok(encodeDecimal(d.shortest, single)).encoding.bits).toBe(b);
    }
  });
  it('half and double basics', () => {
    expect(ok(decodeFloat(0x7bffn, half)).decoded.decimal).toBe('65504');
    expect(ok(decodeFloat(0x0001n, half)).decoded.decimal).toBe(dyadicToDecimal(rat(1n, 1n << 24n)));
    expect(ok(decodeFloat(0xc004000000000000n, double)).decoded.decimal).toBe('-2.5');
    expect(ok(decodeFloat(ref64(0.1), double)).decoded.shortest).toBe('0.1');
  });
  it('neighbours step by one unit in the last place', () => {
    expect(neighbour(0x3f800000n, single, true)).toBe(0x3f800001n);
    expect(neighbour(0x3f800000n, single, false)).toBe(0x3f7fffffn);
    expect(neighbour(0n, single, true)).toBe(1n);
    expect(neighbour(0n, single, false)).toBe(0x80000001n);
    expect(neighbour(0xbf800000n, single, true)).toBe(0xbf7fffffn);
    expect(neighbour(0x7f800000n, single, true)).toBeNull();
    expect(neighbour(0x7fc00000n, single, true)).toBeNull();
  });
});

describe('decimal parsing and rationals', () => {
  it('parses exactly', () => {
    expect(parseDecimal('0.1')).toEqual(rat(1n, 10n));
    expect(parseDecimal('-12.5e-1')).toEqual(rat(-125n, 100n));
    expect(parseDecimal('.5')).toEqual(rat(1n, 2n));
    expect(parseDecimal('5.')).toEqual(rat(5n));
    expect(parseDecimal('1e99999')).toBeNull();
    expect(parseDecimal('.')).toBeNull();
    expect(parseDecimal('1.2.3')).toBeNull();
  });
  it('scientific rounding', () => {
    expect(ratToSci(rat(1n, 3n), 5)).toBe('3.3333e-1');
    expect(ratToSci(rat(99999n, 100000n), 3)).toBe('1e0');
    expect(ratToSci(rat(-5n, 2n), 3)).toBe('-2.5e0');
  });
});

describe('characters', () => {
  it('A is 65 = 0x41 and the euro sign is E2 82 AC', () => {
    const a = characters('A')[0]!;
    expect(a.codePoint).toBe(65);
    expect(a.utf8).toEqual([0x41]);
    expect(characters('€')[0]!.utf8).toEqual([0xe2, 0x82, 0xac]);
  });
  it('handles astral characters and control characters', () => {
    const g = characters('\u{1F600}')[0]!;
    expect(g.utf8).toEqual([0xf0, 0x9f, 0x98, 0x80]);
    expect(g.utf16).toEqual([0xd83d, 0xde00]);
    expect(characters('\n')[0]!.name).toBe('LF');
    expect(characters('')).toEqual([]);
  });
});
