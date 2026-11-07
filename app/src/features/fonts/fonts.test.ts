// The font service, size rules, weights, and type-ahead, with fake fonts. Expected values come from the design
// (section 6.3 metric aliases, section 5 size box) and from the units' definitions (1 in = 72 pt, 1 px = 0.75 pt).
import { describe, expect, it } from 'vitest';
import type { FontFace, FontFamily } from '../../platform/types';
import { buildRows, typeAheadIndex } from './rows';
import { createCatalog, resolveFont, validFontName } from './service';
import { parseSize } from './sizes';
import { splitWeightName, weightsOf } from './weights';

function face(weight: number): FontFace {
  return {
    postScriptName: `F-${weight}`,
    style: 'normal',
    weight,
    stretch: 5,
    monospace: false,
    embedding: 'installable',
    subsettable: true,
    bitmapOnly: false,
    variable: false,
    instance: null,
    unitsPerEm: 1000,
    winAscent: 900,
    winDescent: 200,
    typoLineGap: 0,
    xHeight: null,
    capHeight: null,
  };
}

function family(
  name: string,
  weights: number[] = [400, 700],
  generic: FontFamily['generic'] = 'sans-serif',
): FontFamily {
  return { name, generic, monospace: false, faces: weights.map(face) };
}

const DEVICE = [
  family('Segoe UI', [300, 400, 600, 700]),
  family('Times New Roman', [400, 700], 'serif'),
  family('Arial'),
  family('Georgia', [400], 'serif'),
];

describe('type-ahead', () => {
  it('"Times" lands on "Times New Roman"', () => {
    const rows = buildRows(createCatalog({ families: DEVICE }));
    const row = rows[typeAheadIndex(rows, 'Times')];
    expect(row.kind === 'option' && row.name).toBe('Times New Roman');
  });
  it('falls back to a name that contains the text, and misses cleanly', () => {
    const rows = buildRows(createCatalog({ families: DEVICE }));
    const row = rows[typeAheadIndex(rows, 'new roman')];
    expect(row.kind === 'option' && row.name).toBe('Times New Roman');
    expect(typeAheadIndex(rows, 'zzz')).toBe(-1);
    expect(typeAheadIndex(rows, ' ')).toBe(-1);
  });
  it('lists Theme, then Recent, then All', () => {
    const rows = buildRows(createCatalog({ families: DEVICE, recent: ['Georgia'] }));
    expect(rows.filter((r) => r.kind === 'header').map((r) => r.id)).toEqual(['h-theme', 'h-recent', 'h-all']);
  });
});

describe('resolution', () => {
  const catalog = createCatalog({ families: DEVICE });
  it.each([
    ['Calibri', ['Calibri', 'Carlito']],
    ['Cambria', ['Cambria', 'Caladea']],
    ['Arial', ['Arial', 'Liberation Sans']],
    ['Times New Roman', ['Times New Roman', 'Liberation Serif']],
    ['Courier New', ['Courier New', 'Liberation Mono']],
    ['Helvetica', ['Helvetica', 'Liberation Sans']],
  ])('%s resolves to itself, then its metric stand-in', (name, head) => {
    expect(resolveFont(name, catalog).stack.slice(0, 2)).toEqual(head);
  });
  it('a missing Calibri shows the stand-in, and an installed Arial shows no notice', () => {
    expect(resolveFont('Calibri', catalog)).toMatchObject({ installed: false, standIn: 'Carlito' });
    expect(resolveFont('Arial', catalog)).toMatchObject({ installed: true, standIn: null });
  });
  it('Aptos has no clone: OpenNote Sans with a notice', () => {
    const aptos = resolveFont('Aptos', catalog);
    expect(aptos).toMatchObject({ installed: false, standIn: 'OpenNote Sans' });
    expect(aptos.stack).toEqual(['Aptos', 'OpenNote Sans', 'Segoe UI Variable', 'system-ui', 'sans-serif']);
    expect(aptos.css).toBe('"Aptos", "OpenNote Sans", "Segoe UI Variable", system-ui, sans-serif');
  });
  it('ends each class with its generic stack', () => {
    expect(resolveFont('Georgia', catalog).stack.slice(-3)).toEqual(['Literata', 'Cambria', 'serif']);
    expect(resolveFont('Cambria', catalog).stack).toContain('Literata');
    const mono = createCatalog({ families: [{ ...family('Consolas'), monospace: true }] });
    expect(resolveFont('Consolas', mono).stack.at(-1)).toBe('monospace');
  });
  it('follows theme tokens and the person’s own stand-in', () => {
    const themed = createCatalog({ families: DEVICE, theme: { body: 'Georgia' }, substitutions: { aptos: 'Arial' } });
    expect(resolveFont('+body', themed)).toMatchObject({ target: 'Georgia', installed: true });
    expect(resolveFont('Aptos', themed)).toMatchObject({ standIn: 'Arial' });
    expect(resolveFont('Aptos', themed).stack.slice(0, 2)).toEqual(['Aptos', 'Arial']);
  });
  it('refuses names that could break out of a style value', () => {
    expect(validFontName('Georgia')).toBe('Georgia');
    expect(validFontName(' +heading ')).toBe('+heading');
    expect(validFontName('x"; display: none')).toBeNull();
    expect(validFontName('')).toBeNull();
    expect(validFontName('a'.repeat(64))).toBeNull();
  });
});

describe('the size rules', () => {
  it.each([
    ['12', 12],
    ['12pt', 12],
    ['1in', 72],
    ['16px', 12],
    ['10,5', 10.5],
    ['10.3', 10.5],
    ['2.54cm', 72],
    ['1pc', 12],
    ['1638', 1638],
    ['1', 1],
  ])('%s is %s points', (text, points) => {
    expect(parseSize(text)).toEqual({ ok: true, points });
  });
  it.each(['0', '1639', '0.2', '100in'])('%s is out of range', (text) => {
    expect(parseSize(text)).toEqual({ ok: false, reason: 'range' });
  });
  it.each(['', 'big', '12 furlongs', '-3'])('%j is not a size', (text) => {
    expect(parseSize(text)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('weights', () => {
  it('a family with faces 300, 400, 600, and 700 lists Light, Regular, Semibold, Bold', () => {
    const weights = weightsOf(family('Fake', [700, 300, 600, 400]));
    expect(weights.map((w) => w.weight)).toEqual([300, 400, 600, 700]);
    expect(weights.map((w) => w.key)).toEqual([
      'textFonts.weight300',
      'textFonts.weight400',
      'textFonts.weight600',
      'textFonts.weight700',
    ]);
  });
  it('splits "Segoe UI Semibold" into the family and weight 600', () => {
    const has = (name: string) => DEVICE.some((one) => one.name === name);
    expect(splitWeightName('Segoe UI Semibold', has)).toEqual({ family: 'Segoe UI', weight: 600 });
    expect(splitWeightName('Segoe UI Light', has)).toEqual({ family: 'Segoe UI', weight: 300 });
    expect(splitWeightName('Georgia Bold', has)).toEqual({ family: 'Georgia', weight: 700 });
    expect(splitWeightName('Mystery Bold', has)).toBeNull();
    expect(splitWeightName('Segoe UI', has)).toBeNull();
  });
});
