// Delimited text: CSV, TSV, and the plain text Excel puts on the clipboard. The reader follows RFC 4180: fields
// in double quotes can hold delimiters and line breaks, and a doubled quote is one quote.

export type Delimiter = '\t' | ';' | ',' | '|';

/** Tab comes first, then semicolon, comma, and pipe. A tie between delimiters goes to the earlier one. */
const CANDIDATES: readonly Delimiter[] = ['\t', ';', ',', '|'];
const SNIFF_ROWS = 50;
const SNIFF_CHARS = 65_536;

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Reads delimited text into rows of fields. Blank lines are skipped. `maxRows` stops early. */
export function parseDelimited(text: string, delimiter: string, maxRows = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endRow = (): boolean => {
    row.push(field);
    field = '';
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    return rows.length >= maxRows;
  };
  const source = stripBom(text);
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch !== '"') {
        field += ch;
      } else if (source[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      if (endRow()) return rows;
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** True when at least 90% of the rows have the same number of fields, and that number is 2 or more. */
function isUniform(rows: string[][]): boolean {
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
  const [width, rowsWithIt] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
  return width >= 2 && rowsWithIt >= rows.length * 0.9;
}

/**
 * Finds the delimiter by reading the first 50 rows. A delimiter wins when the same number of fields, at least two,
 * appears on at least 90% of rows. Commas, semicolons, and pipes need two rows, so a sentence with one comma is
 * never a table. Returns null when the text is one column.
 */
export function sniffDelimiter(text: string): Delimiter | null {
  const sample = stripBom(text).slice(0, SNIFF_CHARS);
  for (const delimiter of CANDIDATES) {
    const rows = parseDelimited(sample, delimiter, SNIFF_ROWS);
    if (rows.length === 0 || (delimiter !== '\t' && rows.length < 2)) continue;
    if (isUniform(rows)) return delimiter;
  }
  return null;
}
