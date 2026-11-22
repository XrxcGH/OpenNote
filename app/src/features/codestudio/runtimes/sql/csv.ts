// CSV text to rows, as RFC 4180 describes it: fields split by commas, double quotes around a field that holds a
// comma, a quote, or a line break, and a doubled quote inside quotes for one quote. A final line break adds no row.

/** The rows of `text`, each a list of fields. A byte order mark at the start is dropped. */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[at + 1] === '"') {
        field += '"';
        at += 1;
      } else quoted = false;
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      started = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
      started = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[at + 1] === '\n') at += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      started = false;
    } else {
      field += char;
      started = true;
    }
  }
  if (started || field !== '') {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A name as a SQLite identifier in double quotes. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
