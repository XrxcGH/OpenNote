// A table a query returns, as aligned text lines for the studio console: a header, a rule, then the rows.
// The runtime sends it as the rich type below; the console only shows text.

const TABLE = 'application/vnd.opennote.table+json';

/** The lines for a table message; empty for any other kind of message, or for data that does not parse. */
export function tableText(mime: string, data: string): string {
  if (mime !== TABLE) return '';
  try {
    const table = JSON.parse(data) as { columns?: unknown[]; rows?: unknown[][] };
    // A query plan prints as its own tree after the table, so its rows are not shown twice.
    if ((table.columns ?? []).join() === 'id,parent,notused,detail') return '';
    const cell = (value: unknown) => (value === null || value === undefined ? 'NULL' : String(value));
    const lines = [(table.columns ?? []).map(cell), ...(table.rows ?? []).map((row) => row.map(cell))];
    const widths: number[] = [];
    for (const line of lines) line.forEach((text, at) => (widths[at] = Math.max(widths[at] ?? 0, text.length)));
    const show = (line: string[]) =>
      `${line
        .map((text, at) => text.padEnd(widths[at] ?? 0))
        .join('  ')
        .trimEnd()}\n`;
    return [
      show(lines[0]!),
      `${widths.map((width) => '-'.repeat(width)).join('  ')}\n`,
      ...lines.slice(1).map(show),
    ].join('');
  } catch {
    return '';
  }
}
