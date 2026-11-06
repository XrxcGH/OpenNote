// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling
import { describe, expect, it } from 'vitest';
import { canonical, fnv1a64, type Json } from './json';
import { gc, intern, STYLE_LIMIT, StyleLimitError, styleId, validStyle } from './styles';
import { range, specCase } from './testing';
import type { Sheet } from './types';

describe('style IDs (R-SHT-6)', () => {
  it('hashes with FNV-1a 64 as its published test vectors give', () => {
    // The FNV reference values for the empty string and "a".
    expect(fnv1a64('')).toBe(0xcbf29ce484222325n);
    expect(fnv1a64('a')).toBe(0xaf63dc4c8601ec8cn);
    expect(fnv1a64('foobar')).toBe(0x85944171f73967e8n);
  });

  it('gives what the FNV-1a formula gives in 64-bit arithmetic, for long and non-ASCII text', () => {
    // The formula of the FNV reference, worked byte by byte in BigInt: xor the byte, multiply by the prime, mod 2^64.
    const formula = (text: string): bigint => {
      let hash = 0xcbf29ce484222325n;
      for (const byte of new TextEncoder().encode(text)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) % 2n ** 64n;
      return hash;
    };
    const texts = ['ÿĀ￿', '\u{1f600} cell', 'x'.repeat(5000), '{"a":[1,2]}'];
    for (let n = 0; n < 64; n++) texts.push(String.fromCharCode(...range(1, n).map((i) => (i * 7919 + n) % 0xd7ff)));
    for (const text of texts) expect(fnv1a64(text), text.slice(0, 20)).toBe(formula(text));
  });

  it('writes compact canonical JSON with keys in code point order at every level', () => {
    expect(canonical({ fill: '#fde68a', font: { italic: true, bold: true } })).toBe(
      '{"fill":"#fde68a","font":{"bold":true,"italic":true}}',
    );
    expect(canonical({ b: 1, a: [2.5, null, 'x"\n'] })).toBe('{"a":[2.5,null,"x\\"\\n"],"b":1}');
    // U+FF5E sorts before U+1F600 by code point, though not by UTF-16 code unit.
    expect(canonical({ '\u{1F600}': 1, '～': 2 })).toBe('{"～":2,"\u{1F600}":1}');
  });

  it('gives one ID to styles that differ only by key order', () => {
    const a = styleId({ font: { bold: true }, fill: '#fde68a' });
    const b = styleId({ fill: '#fde68a', font: { bold: true } });
    expect(a).toBe(b);
    // Worked out with the spec's reference writer (docs/format/tools/stamp_v2.py, style_id).
    expect(a).toBe('0qp9wh');
  });

  it('derives every ID the spec fixtures list, collisions included', () => {
    for (const file of ['styles.json', 'style-enums.json']) {
      const cases = specCase(file).expect?.styleIds as { style: Sheet; taken: Sheet; id: string }[];
      expect(cases.length).toBeGreaterThan(0);
      for (const { style, taken, id } of cases) expect(styleId(style, taken)).toBe(id);
    }
  });

  it('gives the IDs the spec fixtures already hold in their style sheets', () => {
    const styles = specCase('styles.json').data.sheet as { styles: Record<string, Sheet> };
    for (const [id, style] of Object.entries(styles.styles)) {
      const others = Object.fromEntries(Object.entries(styles.styles).filter(([k]) => k < id));
      expect(styleId(style, others)).toBe(id);
    }
  });
});

describe('intern and gc', () => {
  it('stores each distinct style once and drops empty objects', () => {
    const sheet: Sheet = {};
    const a = intern(sheet, { font: { bold: true }, fill: '#fde68a' });
    const b = intern(sheet, { fill: '#fde68a', font: { bold: true }, align: {} });
    expect(a).toBe(b);
    expect(Object.keys(sheet.styles as object)).toEqual([a]);
    expect(intern(sheet, { font: {} })).toBeNull();
  });

  it('removes styles that nothing refers to', () => {
    const sheet: Sheet = {
      styles: { aaaaaa: { fill: 'fern' }, bbbbbb: { fill: 'plum' }, cccccc: { fill: 'ink' }, dddddd: { fill: 'rose' } },
      table: { look: { header: 'aaaaaa' } },
      cells: { r: { c: 'bbbbbb' } },
      conditional: { c1: { order: 1, type: 'blank', ranges: [], style: 'cccccc' } },
    };
    gc(sheet);
    expect(Object.keys(sheet.styles as object).sort()).toEqual(['aaaaaa', 'bbbbbb', 'cccccc']);
  });

  it('leaves the styles of a later data version alone', () => {
    const sheet: Sheet = { v: 2, styles: { aaaaaa: { fill: 'fern' } } };
    gc(sheet);
    expect(sheet.styles).toEqual({ aaaaaa: { fill: 'fern' } });
  });

  it('removes unused styles first at the limit, then refuses', () => {
    const styles = Object.fromEntries(Array.from({ length: STYLE_LIMIT }, (_, i) => [`s${i}`, { fmt: `0 ${i}` }]));
    const full: Sheet = { styles, cells: { r: Object.fromEntries(Object.keys(styles).map((id) => [id, id])) } };
    expect(() => intern(full, { fmt: 'new' })).toThrow(StyleLimitError);
    const unused: Sheet = { styles: { ...styles } };
    expect(intern(unused, { fmt: 'new' })).not.toBeNull();
    expect(Object.keys(unused.styles as object)).toHaveLength(1);
  });
});

describe('validStyle', () => {
  it('reads invalid values and unknown keys as missing, and keeps the rest', () => {
    const style = validStyle({
      font: { size: 1639, bold: 'yes', italic: true },
      fill: 'chartreuse',
      align: { rotate: 91, h: 'center' },
      border: { l: { color: 'ink' }, t: { style: 'thin' } },
      glow: 1,
    });
    expect(style).toEqual({ font: { italic: true }, align: { h: 'center' }, border: { t: { style: 'thin' } } });
  });

  it('removes unknown keys that hold a dot, and a gradient with a bad stop, without touching the rest', () => {
    expect(validStyle({ 'a.b': 1, font: { 'x.y': true, bold: true } })).toEqual({ font: { bold: true } });
    expect(validStyle({ 'font.bold': 1, font: { bold: true } })).toEqual({ font: { bold: true } });
    const gradient = {
      gradient: {
        angle: 90,
        stops: [
          { at: 0, color: 'ink' },
          { at: 2, color: 'paper' },
        ],
      },
    };
    expect(validStyle({ fill: gradient, font: { italic: true } })).toEqual({ font: { italic: true } });
  });

  it('accepts sizes from 1 to 1638 in steps of 0.5 and rotations from -90 to 90 or stacked', () => {
    const ok = (font: Json) => validStyle({ font }).font !== undefined;
    expect([1, 409, 409.5, 1638].every((size) => ok({ size }))).toBe(true);
    expect([0.5, 1638.5, 10.25].some((size) => ok({ size }))).toBe(false);
    const rotates = (rotate: Json) => validStyle({ align: { rotate } }).align !== undefined;
    expect([-90, 0, 90, 'stacked'].every(rotates)).toBe(true);
    expect([-91, 91, 45.5, 'up'].some(rotates)).toBe(false);
  });

  it('knows the 13 border styles and none, the 18 patterns, and palette names or #rrggbb', () => {
    const side = (style: string) => validStyle({ border: { b: { style } } }).border !== undefined;
    const borders = 'thin medium thick hair dotted dashed mediumDashed dashDot mediumDashDot dashDotDot';
    const more = 'mediumDashDotDot slantDashDot double none';
    expect(`${borders} ${more}`.split(' ').every(side)).toBe(true);
    expect(side('wavy')).toBe(false);
    const patterns =
      'solid gray125 gray0625 lightGray mediumGray darkGray darkHorizontal darkVertical darkDown darkUp darkGrid ' +
      'darkTrellis lightHorizontal lightVertical lightDown lightUp lightGrid lightTrellis';
    expect(patterns.split(' ')).toHaveLength(18);
    expect(patterns.split(' ').every((pattern) => validStyle({ fill: { pattern } }).fill !== undefined)).toBe(true);
    const fills = (fill: string) => validStyle({ fill }).fill !== undefined;
    expect(['fern', 'honey', '#fde68a', 'theme:accent1', 'none'].every(fills)).toBe(true);
    expect(['#FDE68A', '#fde68', 'chartreuse', 'theme:accent9'].some(fills)).toBe(false);
  });
});
