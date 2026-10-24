// Reading and writing numbers for the life-systems forms: a typed number (with commas, × 10^n or e notation), a
// pasted table of numbers from a spreadsheet, CSV or TSV file, and a result rounded to significant figures.

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

/** A typed number: null when empty, NaN when it is not a number. */
export function parseNumber(raw: string): number | null {
  const text = raw
    .trim()
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .replace(/[−–]/g, '-')
    .replace(/[×x*]10\^?/i, 'e');
  if (text === '') return null;
  return NUMBER.test(text) ? Number(text) : NaN;
}

export interface ParsedRows {
  rows: number[][];
  /** The name in each row's first cell when `labeled`, else ''. */
  labels: string[];
  header: string[] | null;
  bad: number;
}

const isNumber = (cell: string) => {
  const value = parseNumber(cell);
  return value !== null && !Number.isNaN(value);
};

/**
 * Rows of numbers from pasted or opened text. Cells split on tabs, commas, or semicolons when a line has them, else on
 * spaces. A first line that is not all numbers is a header. With `labeled`, a row's first cell may be a name.
 */
export function parseRows(text: string, labeled = false): ParsedRows {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const out: ParsedRows = { rows: [], labels: [], header: null, bad: 0 };
  lines.forEach((line, index) => {
    const splitter = /[\t,;]/.test(line) ? /\s*[\t,;]\s*/ : /\s+/;
    const cells = line
      .trim()
      .split(splitter)
      .filter((cell) => cell !== '');
    const named = labeled && cells.length > 1 && !isNumber(cells[0]);
    const numbers = named ? cells.slice(1) : cells;
    if (numbers.length > 0 && numbers.every(isNumber)) {
      out.rows.push(numbers.map((cell) => parseNumber(cell) as number));
      out.labels.push(named ? cells[0] : '');
    } else if (index === 0) {
      out.header = cells;
    } else {
      out.bad += 1;
    }
  });
  return out;
}

/** A number rounded to `digits` significant figures, with large and small values as 1.5 × 10⁸. */
export function formatNumber(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? '–' : value > 0 ? '∞' : '−∞';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e7 || abs < 1e-4) {
    const [mantissa, exponent] = value.toExponential(digits - 1).split('e');
    const m = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa;
    const e = String(Number(exponent))
      .split('')
      .map((ch) => SUPERSCRIPT[ch] ?? ch)
      .join('');
    return `${m.replace('-', '−')} × 10${e}`;
  }
  const fixed = Number(value.toPrecision(digits)).toString();
  return fixed.replace('-', '−');
}

/** A 95% interval or any range as 'low – high'. */
export const interval = (low: number, high: number, digits = 6): string =>
  `${formatNumber(low, digits)} – ${formatNumber(high, digits)}`;

/** A number for LaTeX: the same rounding, with 1.5 \times 10^{8}. */
export function latexNumber(value: number, digits = 6): string {
  return formatNumber(value, digits)
    .replace('−', '-')
    .replace(/ × 10(.+)$/, (_, power: string) => {
      const plain = power
        .split('')
        .map((ch) => Object.keys(SUPERSCRIPT).find((key) => SUPERSCRIPT[key] === ch) ?? ch)
        .join('');
      return ` \\times 10^{${plain}}`;
    });
}
