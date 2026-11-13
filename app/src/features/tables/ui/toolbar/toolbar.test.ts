// The cell format bar's pure parts: number format edits and the borders presets. Expected values are worked by hand
// from the number format language (DESIGN 5) and from the sides each preset sets (DESIGN 10.5).
import { describe, expect, it } from 'vitest';
import { BORDER_IDS, bordersFor } from './borders';
import type { BorderId } from './borders';
import { EN_US } from '../../engine/locale';
import { accountingCode, choiceOf, currencyCode, hasThousands, stepDecimals, toggleThousands } from './numberFormats';

describe('decimal places', () => {
  const more: [string | undefined, string | null][] = [
    [undefined, '0.0'],
    ['General', '0.0'],
    ['0', '0.0'],
    ['0.00', '0.000'],
    ['#,##0', '#,##0.0'],
    ['#,##0.00', '#,##0.000'],
    ['0%', '0.0%'],
    ['0.00%', '0.000%'],
    ['0.00E+00', '0.000E+00'],
    ['0E+00', '0.0E+00'],
    ['"$"#,##0.00_);("$"#,##0.00)', '"$"#,##0.000_);("$"#,##0.000)'],
    // Accounting: the dash section has only ? placeholders and the text section none, so both stay.
    [
      '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
      '_("$"* #,##0.000_);_("$"* \\(#,##0.000\\);_("$"* "-"??_);_(@_)',
    ],
    ['"0.00 m"0', '"0.00 m"0.0'],
  ];
  for (const [code, expected] of more) {
    it(`adds a decimal to ${code ?? 'nothing'}`, () => expect(stepDecimals(code, 1)).toBe(expected));
  }
  const fewer: [string | undefined, string | null][] = [
    [undefined, null],
    ['General', null],
    ['0.000', '0.00'],
    ['0.00', '0.0'],
    ['0.0', '0'],
    ['0', '0'],
    ['#,##0.0', '#,##0'],
    ['0.00%', '0.0%'],
    ['0.0E+00', '0E+00'],
    ['"$"#,##0.00_);("$"#,##0.00)', '"$"#,##0.0_);("$"#,##0.0)'],
  ];
  for (const [code, expected] of fewer) {
    it(`removes a decimal from ${code ?? 'nothing'}`, () => expect(stepDecimals(code, -1)).toBe(expected));
  }
});

describe('thousands separator', () => {
  const cases: [string | undefined, string][] = [
    [undefined, '#,##0'],
    ['General', '#,##0'],
    ['0', '#,##0'],
    ['0.00', '#,##0.00'],
    ['0000', '0,000'],
    ['#,##0', '###0'],
    ['#,##0.00', '###0.00'],
    // Every section follows the first: off removes the comma of the negative section too, on adds it to both.
    ['"$"#,##0.00_);("$"#,##0.00)', '"$"###0.00_);("$"###0.00)'],
    ['"$"0.00_);("$"0.00)', '"$"#,##0.00_);("$"#,##0.00)'],
    [
      '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
      '_("$"* ###0.00_);_("$"* \\(###0.00\\);_("$"* "-"??_);_(@_)',
    ],
  ];
  for (const [code, expected] of cases) {
    it(`turns ${code ?? 'nothing'} into ${expected}`, () => expect(toggleThousands(code)).toBe(expected));
  }
  it('reads the separator only outside quotes', () => {
    expect(hasThousands('#,##0')).toBe(true);
    expect(hasThousands('"a,b"0')).toBe(false);
    expect(hasThousands('0.00')).toBe(false);
  });
});

describe('currency codes', () => {
  it('writes the sign, grouping, and negatives in parentheses, and the accounting form', () => {
    expect(currencyCode(EN_US)).toBe('"$"#,##0.00_);("$"#,##0.00)');
    expect(accountingCode(EN_US)).toBe('_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)');
  });
});

describe('border presets', () => {
  const box = { top: 1, left: 1, bottom: 2, right: 2 };
  const line = { style: 'thin' };
  /** Which sides of which cell a preset sets, as `B2:t` strings. */
  const sets = (id: BorderId, b = box): string[] => {
    const out: string[] = [];
    for (const step of bordersFor(id, b, line)) {
      const [[side, value]] = Object.entries(step.change.border as object);
      for (let r = step.box.top; r <= step.box.bottom; r++)
        for (let c = step.box.left; c <= step.box.right; c++)
          out.push(`${'ABCD'[c]}${r + 1}:${side}${value ? '' : '-'}`);
    }
    return out.sort();
  };
  it('has sixteen presets', () => expect(BORDER_IDS).toHaveLength(16));
  it('draws the outside of B2:C3 and nothing inside', () => {
    expect(sets('outside')).toEqual(['B2:l', 'B2:t', 'B3:b', 'B3:l', 'C2:r', 'C2:t', 'C3:b', 'C3:r']);
  });
  it('draws a line shared by two cells on both of them', () => {
    expect(sets('insideH')).toEqual(['B2:b', 'B3:t', 'C2:b', 'C3:t']);
    expect(sets('insideV')).toEqual(['B2:r', 'B3:r', 'C2:l', 'C3:l']);
  });
  it('has no inside lines in a single cell', () => {
    expect(sets('insideH', { top: 0, left: 0, bottom: 0, right: 0 })).toEqual([]);
  });
  it('draws thick and double lines whatever the menu line style is', () => {
    const thick = bordersFor('thickOutside', box, line).map(
      (step) => step.change.border as Record<string, { style: string }>,
    );
    expect(thick.every((border) => Object.values(border).every((side) => side.style === 'thick'))).toBe(true);
    const double = bordersFor('bottomDouble', box, line)[0].change.border as { b: { style: string } };
    expect(double.b.style).toBe('double');
  });
  it('clears every side, diagonals included, for No border', () => {
    const cleared = bordersFor('none', box, line)
      .map((step) => Object.keys(step.change.border as object)[0])
      .sort();
    expect(cleared).toEqual(['b', 'dd', 'du', 'l', 'r', 't']);
  });
  it('draws with the line color when there is one', () => {
    const step = bordersFor('top', box, { style: 'medium', color: 'theme:accent1' })[0];
    expect(step.change.border).toEqual({ t: { style: 'medium', color: 'theme:accent1' } });
  });
});

describe('which number format choice a code is', () => {
  it('names the choice whose code the cell has', () => {
    expect(choiceOf(undefined, EN_US)).toBe('general');
    expect(choiceOf(currencyCode(EN_US), EN_US)).toBe('currency');
    expect(choiceOf(accountingCode(EN_US), EN_US)).toBe('accounting');
    expect(choiceOf('0%', EN_US)).toBe('percent');
    expect(choiceOf('@', EN_US)).toBe('text');
    expect(choiceOf('0.000', EN_US)).toBeNull();
  });
});

describe('decimal places limits and quoted text', () => {
  it('stops at 30 decimal places, the limit of Excel and Sheets', () => {
    let code: string | null = '0';
    for (let i = 0; i < 100; i++) code = stepDecimals(code ?? undefined, 1);
    expect(code).toBe(`0.${'0'.repeat(30)}`);
  });

  it('reads a quoted literal that ends in an underscore as text', () => {
    expect(stepDecimals('"x_"0.00', 1)).toBe('"x_"0.000');
    expect(stepDecimals('"x_"0.00', -1)).toBe('"x_"0.0');
    expect(toggleThousands('"x_"0')).toBe('"x_"#,##0');
  });
});
