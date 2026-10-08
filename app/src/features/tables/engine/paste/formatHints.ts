// What a spreadsheet number format means for a pasted column. Excel writes `mso-number-format` in a style block, Google
// Sheets writes a pattern in `data-sheets-numberformat`, and LibreOffice writes a code in `sdnum`.

export type FormatHint = 'percent' | 'currency' | 'date' | 'number';

const NAMED: Record<string, FormatHint> = {
  percent: 'percent',
  currency: 'currency',
  accounting: 'currency',
  'short date': 'date',
  'medium date': 'date',
  'long date': 'date',
  'general date': 'date',
  'short time': 'date',
  'long time': 'date',
  general: 'number',
  fixed: 'number',
  standard: 'number',
  scientific: 'number',
};

/** Reads the escapes Excel uses in style blocks, such as \0022 for a quote and \. for a period. */
export function unescapeFormat(code: string): string {
  return code
    .replace(/\\00([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1');
}

/** Says whether a format code shows a percent, a currency amount, a date or time, or a plain number. */
export function hintFromFormat(code: string): FormatHint | null {
  const plain = unescapeFormat(code)
    .replace(/\[\$-[0-9a-fA-F]+\]/g, '')
    .trim();
  const named = NAMED[plain.toLowerCase()];
  if (named) return named;
  if (plain === '@') return null;
  if (/[$€£¥]/.test(plain)) return 'currency';
  if (plain.includes('%')) return 'percent';
  const pattern = plain.replace(/"[^"]*"|\[[^\]]*\]/g, '');
  if (/[ymdhs]/i.test(pattern) && !/^general/i.test(pattern)) return 'date';
  return plain === '' ? null : 'number';
}
