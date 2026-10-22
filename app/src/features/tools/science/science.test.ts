// Significant figures, CODATA constants, and the quick LaTeX palette.
import { describe, expect, it } from 'vitest';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { calculate, evaluateNotes } from '../calculator';
import { isUnitName } from '../calculator/unitSystem';
import {
  CODATA,
  codataInsertLatex,
  codataInsertText,
  codataText,
  codataUncertainty,
  codataValue,
  searchCodata,
} from './codata';
import { sigFigAnswers } from './notes';
import { countFigures, changeNotation, roundFigures, sigFigCalculate } from './sigfigs';
import { GAP, SNIPPETS, applySnippet, withoutGaps } from './snippets';
import { DEFAULT_REGION } from '../calculator';

describe('counting significant figures', () => {
  it.each([
    ['0.00120', 3],
    ['1.20', 3],
    ['120', 2],
    ['1200', 2],
    ['1200.', 4],
    ['1,200.5', 5],
    ['1.20e3', 3],
    ['1.2×10³', 2],
    ['-0.050', 2],
    ['100.0', 4],
    ['0', 1],
    ['007', 1],
  ])('counts %s as %i', (text, figures) => {
    expect(countFigures(text)?.figures).toBe(figures);
  });

  it('is not fooled by words', () => {
    expect(countFigures('abc')).toBeNull();
    expect(countFigures('')).toBeNull();
    expect(countFigures('1.2.3')).toBeNull();
  });

  it('warns that trailing zeros of a whole number are unclear, and gives the clear form', () => {
    const counted = countFigures('1200');
    expect(counted?.ambiguous).toBe(true);
    expect(counted?.scientific).toBe('1.2×10³');
    expect(countFigures('1200.')?.ambiguous).toBe(false);
    expect(countFigures('1.200e3')?.figures).toBe(4);
  });
});

describe('rounding and notation', () => {
  it('rounds half away from zero on the digits, not on a float', () => {
    expect(roundFigures('1.45', 2)).toBe('1.5');
    expect(roundFigures('2.675', 3)).toBe('2.68');
    expect(roundFigures('-2.5', 1)).toBe('-3');
    expect(roundFigures('0.000456', 2)).toBe('0.00046');
  });

  it('carries through nines', () => {
    expect(roundFigures('9.96', 2)).toBe('10');
    expect(roundFigures('999.5', 3)).toBe('1000');
    expect(roundFigures('0.0996', 2)).toBe('0.10');
  });

  it('pads zeros so the count shows', () => {
    expect(roundFigures('1.5', 4)).toBe('1.500');
    expect(roundFigures('12', 4)).toBe('12.00');
    expect(roundFigures('1234', 2)).toBe('1200');
  });

  it('writes scientific and engineering notation without changing the figures', () => {
    expect(changeNotation('0.00120', 'scientific')).toBe('1.20×10⁻³');
    expect(changeNotation('12345.6', 'scientific')).toBe('1.23456×10⁴');
    expect(changeNotation('0.00120', 'engineering')).toBe('1.20×10⁻³');
    expect(changeNotation('12345.6', 'engineering')).toBe('12.3456×10³');
    expect(changeNotation('1.2×10⁻³', 'plain')).toBe('0.0012');
    expect(roundFigures('123456', 3, 'scientific')).toBe('1.23×10⁵');
    expect(roundFigures('123456', 3, 'engineering')).toBe('123×10³');
  });

  it('refuses a figure count it cannot use', () => {
    expect(roundFigures('1.5', 0)).toBeNull();
    expect(roundFigures('x', 3)).toBeNull();
  });
});

describe('calculating with significant figures', () => {
  const run = (source: string) => sigFigCalculate(source);

  it('multiplies and divides to the fewest figures', () => {
    const r = run('2.50 * 3.1');
    expect(r).toMatchObject({ ok: true, text: '7.8', rule: 'multiply', limit: 2 });
    expect(run('6.0 / 3.00')).toMatchObject({ ok: true, text: '2.0' });
    expect(run('1.234 * 5.6789')).toMatchObject({ ok: true, text: '7.008' });
  });

  it('adds and subtracts to the fewest decimal places', () => {
    expect(run('12.11 + 0.3')).toMatchObject({ ok: true, text: '12.4', rule: 'add', limit: 1 });
    expect(run('100.0 - 0.25')).toMatchObject({ ok: true, text: '99.8' });
    expect(run('1.0 + 2.55')).toMatchObject({ ok: true, text: '3.6' });
  });

  it('uses the rule of the last step and keeps middle digits', () => {
    // (12.11 + 0.3) is 12.41 with one decimal place (three figures), times 2.0 (two figures) is 25.
    const r = run('(12.11 + 0.3) * 2.0');
    expect(r).toMatchObject({ ok: true, text: '25', rule: 'multiply', limit: 2 });
  });

  it('treats constants as exact', () => {
    expect(run('2pi * 1.50')).toMatchObject({ ok: true, text: '9.42' });
    expect(run('pi')).toMatchObject({ ok: true, rule: 'exact' });
    // A whole number written plainly is a measurement: 2 has one figure.
    expect(run('2 * pi * 1.50')).toMatchObject({ ok: true, text: '9' });
  });

  it('writes a hidden-zero answer in scientific notation', () => {
    const r = run('1200 * 3.1');
    expect(r).toMatchObject({ ok: true, text: '3.7×10³' });
  });

  it('keeps the figures through roots and powers', () => {
    expect(run('sqrt(2.0)')).toMatchObject({ ok: true, text: '1.4', rule: 'function' });
    expect(run('3.00^2')).toMatchObject({ ok: true, text: '9.00' });
    expect(run('-4.50 * 2')).toMatchObject({ ok: true });
  });

  it('gives up on what the rules do not cover', () => {
    expect(run('5 km')).toEqual({ ok: false });
    expect(run('ans * 2')).toEqual({ ok: false });
    expect(run('2 +')).toEqual({ ok: false });
    expect(run('')).toEqual({ ok: false });
    expect(run('sin(30°)')).toEqual({ ok: false });
  });
});

describe('significant figures on page lines', () => {
  const answers = (lines: string[]) => sigFigAnswers(lines, evaluateNotes(lines), DEFAULT_REGION);

  it('rounds a question and says which rule was used', () => {
    const a = answers(['2.50 * 3.1 =']);
    expect(a.get(0)?.text).toBe('7.8');
    expect(a.get(0)?.rule).toContain('fewest');
  });

  it('passes the figures of a definition on to later lines', () => {
    const a = answers(['width = 12.11', 'extra = 0.3', 'width + extra =', 'width * 2 =']);
    expect(a.get(2)?.text).toBe('12.4');
    // 2 has one figure: 24.22 is 20.
    expect(a.get(3)?.text).toBe('2×10¹');
  });

  it('leaves unit lines and plain text alone', () => {
    expect(answers(['5 mi in km =', 'hello there']).size).toBe(0);
    expect(answers(['d = 5 m', 'd * 2 =']).size).toBe(0);
  });
});

describe('scientific constants', () => {
  it('has the 2022 CODATA values for the famous ones', () => {
    const by = (id: string) => CODATA.find((c) => c.id === id);
    expect(codataValue(by('c')!)).toBe(299792458);
    expect(codataValue(by('h')!)).toBe(6.62607015e-34);
    expect(codataValue(by('kB')!)).toBe(1.380649e-23);
    expect(codataValue(by('NA')!)).toBe(6.02214076e23);
    expect(codataValue(by('G')!)).toBe(6.6743e-11);
    expect(codataValue(by('me')!)).toBe(9.1093837139e-31);
    expect(codataValue(by('mp')!)).toBe(1.67262192595e-27);
    expect(codataValue(by('mn')!)).toBe(1.67492750056e-27);
  });

  it('reads the uncertainty from the digits in brackets', () => {
    const G = CODATA.find((c) => c.id === 'G')!;
    expect(codataUncertainty(G)).toBeCloseTo(1.5e-15, 25);
    expect(codataText(G)).toBe('6.67430(15)×10⁻¹¹');
    expect(codataText(G, false)).toBe('6.67430×10⁻¹¹');
    const h = CODATA.find((c) => c.id === 'h')!;
    expect(codataUncertainty(h)).toBe(0);
    expect(codataText(h)).toBe('6.62607015×10⁻³⁴');
  });

  it('has unique ids, symbols a person can type, and live names that never clash with a unit', () => {
    expect(new Set(CODATA.map((c) => c.id)).size).toBe(CODATA.length);
    const live = CODATA.map((c) => c.calc).filter((name) => name !== '');
    expect(new Set(live).size).toBe(live.length);
    // These names were the calculator's before the picker, so they keep working as they did. Every name added since is free.
    const older = new Set(['c', 'g', 'G', 'h', 'hbar', 'kB', 'NA', 'R', 'qe', 'me', 'mp', 'eps0', 'mu0', 'atm']);
    for (const name of live.filter((one) => !older.has(one))) expect(isUnitName(name), name).toBe(false);
  });

  it('is usable in the calculator and in lines of math', () => {
    expect(calculate('c')).toEqual({ ok: true, value: 299792458 });
    expect(calculate('mneutron / mp')).toMatchObject({ ok: true });
    const [line] = evaluateNotes(['kB * 300 =']);
    expect(line.kind).toBe('result');
    for (const one of CODATA.filter((c) => c.calc !== '')) {
      const result = calculate(one.calc);
      expect(result.ok && result.value, one.calc).toBe(codataValue(one));
    }
  });

  it('inserts the symbol, the value, or both, as text or as LaTeX', () => {
    const kB = CODATA.find((c) => c.id === 'kB')!;
    expect(codataInsertText(kB, 'symbol')).toBe('kB');
    expect(codataInsertText(kB, 'value')).toBe('1.380649×10⁻²³ J K⁻¹');
    expect(codataInsertText(kB, 'both')).toBe('kB = 1.380649×10⁻²³ J K⁻¹');
    expect(codataInsertLatex(kB, 'symbol')).toBe('k_\\mathrm{B}');
    expect(codataInsertLatex(kB, 'both')).toBe('k_\\mathrm{B} = 1.380649\\times10^{-23}\\,\\mathrm{J\\,K^{-1}}');
    const alpha = CODATA.find((c) => c.id === 'alpha')!;
    expect(codataInsertText(alpha, 'value')).toBe('7.2973525643(11)×10⁻³');
  });

  it('searches by name, symbol, group, and other words', () => {
    const ids = (q: string) => searchCodata(q).map((c) => c.id);
    expect(ids('planck')).toEqual(expect.arrayContaining(['h', 'hbar']));
    expect(ids('boltz')).toContain('kB');
    expect(ids('gravity')).toEqual(expect.arrayContaining(['G', 'g']));
    expect(ids('electromagnetic')).toContain('e');
    expect(ids('speed light')).toEqual(['c']);
    expect(ids('zzzz')).toEqual([]);
    expect(ids('')).toHaveLength(CODATA.length);
  });
});

describe('the quick LaTeX palette', () => {
  it('has a name for every snippet, and unique ids', () => {
    expect(new Set(SNIPPETS.map((s) => s.id)).size).toBe(SNIPPETS.length);
    for (const one of SNIPPETS)
      expect(t(`science.latex.snippet.${one.id}` as MessageKey), one.id).not.toMatch(/^science\./);
  });

  it('puts a snippet at the caret and selects the first gap', () => {
    const fraction = SNIPPETS.find((s) => s.id === 'fraction')!;
    const out = applySnippet('x = ', 4, 4, fraction);
    expect(out.text).toBe(`x = \\frac{${GAP}}{${GAP}}`);
    expect(out.text.slice(out.from, out.to)).toBe(GAP);
    expect(withoutGaps(out.text)).toBe('x = \\frac{}{}');
  });

  it('replaces a selection, and leaves the caret after a snippet with no gap', () => {
    const pi = SNIPPETS.find((s) => s.id === 'pi')!;
    const out = applySnippet('2 x 3', 2, 3, pi);
    expect(out.text).toBe('2 \\pi 3');
    expect(out.from).toBe(out.to);
  });
});
