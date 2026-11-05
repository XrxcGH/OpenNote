// The LibreOffice oracle (ADR 0060, DESIGN.md section 8.3). A development tool, never shipped: it reads a fixture file
// of formula cases, writes them into a flat OpenDocument spreadsheet (.fods, plain XML), lets LibreOffice Calc compute
// them headless, and reads the values back from a CSV export. LibreOffice (MPL 2.0) is run as a separate program and
// never bundled.
//
//   node tools/sheet-oracle/oracle.ts <fixture.json>          prints each case's value
//   node tools/sheet-oracle/oracle.ts <fixture.json> --write  stores them as `expected` of the calc-oracle cases
//   node tools/sheet-oracle/oracle.ts <fixture.json> --check  fails when a calc-oracle case's value changed
//
// A fixture is { "oracle": { "version": ... }, "cases": [ { formula, cells, expected, tolerance, source, note } ] }.
// `formula` is in Excel's form with its "=", `cells` puts inputs in cells by A1 name, and `source` "calc-oracle" marks
// the cases whose `expected` this tool owns. A case marked "oracle-differs" keeps Excel's value and is not checked.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type CellInput = number | string | boolean;
export type Expected = number | string | boolean;

export interface OracleCase {
  formula: string;
  cells?: Record<string, CellInput>;
  expected?: Expected;
  tolerance?: number;
  source: string;
  note?: string;
  /** Set when LibreOffice disagrees with Excel's documented value; the nightly check skips the case. */
  'oracle-differs'?: boolean;
}

export interface Fixture {
  oracle?: { version: string };
  cases: OracleCase[];
}

/** The column the case's formula goes in, past any input a case would use. */
const RESULT_CELL = 'ZZ1';

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Zero-based column and row of an A1 name. */
export function cellIndex(name: string): { col: number; row: number } {
  const match = /^([A-Z]{1,3})(\d+)$/.exec(name.toUpperCase());
  if (!match) throw new Error(`Not a cell name: ${name}`);
  let col = 0;
  for (const ch of match[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return { col: col - 1, row: Number(match[2]) - 1 };
}

function cellXml(value: CellInput | { formula: string } | undefined): string {
  if (value === undefined) return '<table:table-cell/>';
  if (typeof value === 'object') return `<table:table-cell table:formula="msoxl:${escapeXml(value.formula)}"/>`;
  if (typeof value === 'number') {
    return `<table:table-cell office:value-type="float" office:value="${value}"><text:p>${value}</text:p></table:table-cell>`;
  }
  if (typeof value === 'boolean') {
    const word = value ? 'true' : 'false';
    return `<table:table-cell office:value-type="boolean" office:boolean-value="${word}"><text:p>${word.toUpperCase()}</text:p></table:table-cell>`;
  }
  return `<table:table-cell office:value-type="string"><text:p>${escapeXml(value)}</text:p></table:table-cell>`;
}

/** One sheet's rows from cell values by position. */
function sheetXml(name: string, cells: Map<string, CellInput | { formula: string }>): string {
  const grid = new Map<number, Map<number, CellInput | { formula: string }>>();
  let lastRow = 0;
  for (const [ref, value] of cells) {
    const { col, row } = cellIndex(ref);
    if (!grid.has(row)) grid.set(row, new Map());
    grid.get(row)!.set(col, value);
    lastRow = Math.max(lastRow, row);
  }
  const rows: string[] = [];
  for (let r = 0; r <= lastRow; r++) {
    const row = grid.get(r) ?? new Map();
    const lastCol = Math.max(-1, ...row.keys());
    const xml = Array.from({ length: lastCol + 1 }, (_, c) => cellXml(row.get(c))).join('');
    rows.push(`<table:table-row>${xml || '<table:table-cell/>'}</table:table-row>`);
  }
  return `<table:table table:name="${escapeXml(name)}">${rows.join('')}</table:table>`;
}

/**
 * The flat spreadsheet for a list of cases. The first sheet, which the CSV export writes, holds one result per row;
 * each case gets its own sheet, named c1, c2, and so on, with its inputs and its formula, so cases never share cells.
 */
export function fodsFor(cases: readonly OracleCase[]): string {
  const results = new Map<string, { formula: string }>();
  const sheets: string[] = [];
  cases.forEach((c, i) => {
    const name = `c${i + 1}`;
    results.set(`A${i + 1}`, { formula: `=${name}!${RESULT_CELL}` });
    const cells = new Map<string, CellInput | { formula: string }>(Object.entries(c.cells ?? {}));
    cells.set(RESULT_CELL, { formula: c.formula.startsWith('=') ? c.formula : `=${c.formula}` });
    sheets.push(sheetXml(name, cells));
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
    ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
    ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
    ' office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">',
    '<office:body><office:spreadsheet>',
    sheetXml('results', results),
    ...sheets,
    '</office:spreadsheet></office:body></office:document>',
  ].join('\n');
}

/** Splits CSV text into rows of fields. Quoted fields may hold commas, doubled quotes, and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A value as the CSV export wrote it: a number, TRUE or FALSE, or text such as an error token. */
export function readValue(text: string): Expected {
  if (/^(TRUE|FALSE)$/.test(text)) return text === 'TRUE';
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) ? n : text;
}

/** The LibreOffice program: SOFFICE when set, else soffice on the path. */
export function sofficePath(): string {
  return process.env.SOFFICE ?? 'soffice';
}

/** LibreOffice's version line, or null when it cannot run. */
export function sofficeVersion(): string | null {
  try {
    return execFileSync(sofficePath(), ['--version'], { encoding: 'utf8', timeout: 60_000 }).trim();
  } catch {
    return null;
  }
}

/**
 * Comma separators, double quotes, UTF-8, from line 1, and raw values rather than the shown text, so numbers keep
 * every digit (LibreOffice's CSV filter options, in their documented order).
 */
const CSV_FILTER = 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false';

/** Computes every case with LibreOffice and returns the values in order. */
export function runOracle(cases: readonly OracleCase[]): Expected[] {
  const dir = mkdtempSync(join(tmpdir(), 'sheet-oracle-'));
  try {
    const input = join(dir, 'cases.fods');
    writeFileSync(input, fodsFor(cases), 'utf8');
    execFileSync(
      sofficePath(),
      [
        '--headless',
        '--norestore',
        `-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`,
        '--convert-to',
        CSV_FILTER,
        '--outdir',
        dir,
        input,
      ],
      { stdio: 'pipe', timeout: 300_000 },
    );
    const csv = readdirSync(dir).find((name) => name.endsWith('.csv'));
    if (csv === undefined) throw new Error('LibreOffice wrote no CSV file.');
    const text = readFileSync(join(dir, csv), 'utf8');
    // A byte order mark at the start is not part of the first value.
    const rows = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return cases.map((_, i) => readValue(rows[i]?.[0] ?? ''));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Whether a computed value matches the expected one, within the case's tolerance for numbers. */
export function same(expected: Expected | undefined, actual: Expected, tolerance = 0): boolean {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const scale = Math.max(1, Math.abs(expected));
    return Math.abs(expected - actual) <= Math.max(tolerance, 1e-15 * scale);
  }
  return expected === actual;
}

/** The calc-oracle cases whose value changed, as messages. */
export function changes(fixture: Fixture, values: readonly Expected[]): string[] {
  const out: string[] = [];
  fixture.cases.forEach((c, i) => {
    if (c.source !== 'calc-oracle' || c['oracle-differs'] === true) return;
    if (!same(c.expected, values[i], c.tolerance)) {
      out.push(`${c.formula}: committed ${JSON.stringify(c.expected)}, LibreOffice ${JSON.stringify(values[i])}`);
    }
  });
  return out;
}

function main(args: string[]): number {
  const [path, mode] = args;
  if (path === undefined) {
    console.error('Usage: node tools/sheet-oracle/oracle.ts <fixture.json> [--write | --check]');
    return 2;
  }
  const version = sofficeVersion();
  if (version === null) {
    console.error(`LibreOffice did not run (${sofficePath()}). Install it, or set SOFFICE to its program.`);
    return 2;
  }
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as Fixture;
  const values = runOracle(fixture.cases);
  if (mode === '--check') {
    const changed = changes(fixture, values);
    for (const line of changed) console.error(line);
    console.log(`${fixture.cases.length} cases, ${changed.length} changed, ${version}`);
    return changed.length === 0 ? 0 : 1;
  }
  if (mode === '--write') {
    fixture.cases.forEach((c, i) => {
      if (c.source === 'calc-oracle' && c['oracle-differs'] !== true) c.expected = values[i];
    });
    fixture.oracle = { version };
    writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  }
  fixture.cases.forEach((c, i) => console.log(`${c.formula}\t${JSON.stringify(values[i])}`));
  return 0;
}

// Runs only as a program, not when a test imports it.
if (process.argv[1]?.endsWith('oracle.ts')) {
  process.exitCode = main(process.argv.slice(2));
}
