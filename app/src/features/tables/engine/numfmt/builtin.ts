// The built-in number format IDs of ECMA-376 Part 1, 18.8.30. A file may name a format by ID alone. IDs 0 to 13 and
// 37 to 49 have fixed codes; 5 to 8 are the currency formats in the en-US form. The date and time IDs depend on the
// region: 14 and 22 are the region's short date (and time), and the East Asian IDs 27 to 36 and 50 to 81 read as
// the nearest region-neutral format when the region is not one they were made for.

import type { Locale } from '../locale';
import { regionDateCode } from './region';

const FIXED: Readonly<Record<number, string>> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  5: '"$"#,##0_);("$"#,##0)',
  6: '"$"#,##0_);[Red]("$"#,##0)',
  7: '"$"#,##0.00_);("$"#,##0.00)',
  8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  48: '##0.0E+0',
  49: '@',
};

/** East Asian and Thai IDs, read as region-neutral codes outside their regions. */
const NEUTRAL: Readonly<Record<number, string>> = {
  32: 'h:mm',
  33: 'h:mm:ss',
  34: 'h:mm AM/PM',
  35: 'h:mm:ss AM/PM',
  59: '0',
  60: '0.00',
  61: '#,##0',
  62: '#,##0.00',
  67: '0%',
  68: '0.00%',
  69: '# ?/?',
  70: '# ??/??',
  76: 'h:mm',
  77: 'h:mm:ss',
  78: 'mm:ss',
  79: '[h]:mm:ss',
  80: 'mm:ss.0',
};

const SHORT_DATE = new Set([14, 27, 28, 29, 30, 31, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58, 71, 72, 73, 74, 75, 81]);

/** The code of a built-in ID in the person's region, or null for an ID that has none (such as 23 to 26). */
export function builtinCode(id: number, locale: Locale): string | null {
  if (FIXED[id] !== undefined) return FIXED[id];
  if (NEUTRAL[id] !== undefined) return NEUTRAL[id];
  if (id === 22) return `${regionDateCode(locale, 'short')} h:mm`;
  if (SHORT_DATE.has(id)) return regionDateCode(locale, 'short');
  return null;
}

/** The built-in ID of a code, so a writer can name it by ID, or null. Region-dependent IDs are not matched. */
export function builtinId(code: string): number | null {
  for (const [id, fixed] of Object.entries(FIXED)) if (fixed === code) return Number(id);
  return null;
}
