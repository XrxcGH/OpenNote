// The SQL runtime over SQLite (DESIGN 2.1, 4.6): one in-memory database per run. The project's other .sql files run
// first (schema files, then seed files, then the rest by name), then the main file. Each statement that gives
// columns sends its rows as a table; EXPLAIN QUERY PLAN also prints as a tree. `.import FILE TABLE` loads a CSV file
// from the project. Extension loading is off. An error stops the run at that statement.

import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { RICH_LIMITS } from '../../contracts/run';
import type { Emit, RunContext, RunEnd, RunFile, RunRequest } from '../../contracts/run';
import { t } from '../../../../strings/t';
import { parseCsv, quoteIdentifier } from './csv';
import { lineColumn, walk } from './walk';
import type { SqlFailure } from './walk';

export type Db = InstanceType<Sqlite3Static['oo1']['DB']>;

/** The serialized table stays well under the page's limit for one message. */
const TABLE_BYTES = 4 * 1024 * 1024;

/** Thrown inside a run to end it with a status. */
class Stop extends Error {
  constructor(readonly end: RunEnd) {
    super(end.message);
  }
}

/** A new in-memory database with extension loading off. */
export function openDatabase(s3: Sqlite3Static): Db {
  const db = new s3.oo1.DB(':memory:', 'c');
  s3.capi.sqlite3_db_config(db.pointer!, s3.capi.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, 0, 0);
  return db;
}

/** Schema files first, then seed files, then the rest by name; the main file is not among them. */
export function setupFiles(files: readonly RunFile[], main: string): RunFile[] {
  const rank = (path: string) => (/(^|\/)schema[^/]*$/i.test(path) ? 0 : /(^|\/)seed[^/]*$/i.test(path) ? 1 : 2);
  return files
    .filter((file) => file.path !== main && file.path.toLowerCase().endsWith('.sql'))
    .sort((a, b) => rank(a.path) - rank(b.path) || (a.path < b.path ? -1 : 1));
}

function blobText(s3: Sqlite3Static, stmt: number, index: number): string {
  const { capi } = s3;
  const size = capi.sqlite3_column_bytes(stmt, index);
  const start = capi.sqlite3_column_blob(stmt, index) as number;
  const bytes = s3.wasm.heap8u().slice(start, start + Math.min(size, 32));
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `x'${hex}'${size > 32 ? '…' : ''}`;
}

function columnValue(s3: Sqlite3Static, stmt: number, index: number): unknown {
  const { capi } = s3;
  switch (capi.sqlite3_column_type(stmt, index)) {
    case capi.SQLITE_INTEGER: {
      const value = capi.sqlite3_column_int64(stmt, index) as number | bigint;
      return typeof value === 'bigint' && !Number.isSafeInteger(Number(value)) ? value.toString() : Number(value);
    }
    case capi.SQLITE_FLOAT: {
      const value = capi.sqlite3_column_double(stmt, index);
      return Number.isFinite(value) ? value : String(value);
    }
    case capi.SQLITE_TEXT:
      return capi.sqlite3_column_text(stmt, index);
    case capi.SQLITE_BLOB:
      return blobText(s3, stmt, index);
    default:
      return null;
  }
}

interface Table {
  columns: string[];
  rows: unknown[][];
  cut: boolean;
  /** All the rows the statement gave, kept, or not. */
  count: number;
}

/** Steps `stmt` to its end. Rows past the cap are counted, not kept. Throws {code, message} on a SQLite error. */
function collect(s3: Sqlite3Static, db: Db, stmt: number, check: () => void): Table {
  const { capi } = s3;
  const width = capi.sqlite3_column_count(stmt);
  const columns = Array.from({ length: width }, (_, index) => capi.sqlite3_column_name(stmt, index));
  const rows: unknown[][] = [];
  let count = 0;
  let size = 0;
  let cut = false;
  for (;;) {
    const rc = capi.sqlite3_step(stmt);
    if (rc === capi.SQLITE_DONE) break;
    if (rc !== capi.SQLITE_ROW) throw { code: capi.sqlite3_js_rc_str(rc), message: capi.sqlite3_errmsg(db.pointer!) };
    count += 1;
    if (count % 1000 === 0) check();
    if (cut) continue;
    const row = Array.from({ length: width }, (_, index) => columnValue(s3, stmt, index));
    size += JSON.stringify(row).length;
    if (rows.length >= RICH_LIMITS.tableRows || size > TABLE_BYTES) cut = true;
    else rows.push(row);
  }
  return { columns, rows, cut, count };
}

/** The tree SQLite's shell prints for EXPLAIN QUERY PLAN, from the (id, parent, notused, detail) rows. */
export function planTree(rows: readonly unknown[][]): string {
  const children = new Map<number, { id: number; detail: string }[]>();
  for (const row of rows) {
    const parent = Number(row[1]);
    const list = children.get(parent) ?? [];
    list.push({ id: Number(row[0]), detail: String(row[3]) });
    children.set(parent, list);
  }
  const lines = ['QUERY PLAN'];
  const draw = (parent: number, prefix: string) => {
    const list = children.get(parent) ?? [];
    list.forEach((node, index) => {
      const last = index === list.length - 1;
      lines.push(`${prefix}${last ? '`--' : '|--'}${node.detail}`);
      draw(node.id, prefix + (last ? '   ' : '|  '));
    });
  };
  draw(0, '');
  return `${lines.join('\n')}\n`;
}

const isPlan = (text: string) => /^\s*explain\s+query\s+plan\b/i.test(text);

export interface Session {
  s3: Sqlite3Static;
  db: Db;
  emit: Emit;
  context: RunContext;
  /** Whether results show: false while the schema and seed files run. */
  loud: boolean;
  /** Why the progress handler stopped a statement: set by the handler, read when SQLite reports an interrupt. */
  stopped: 'time' | 'memory' | null;
}

function show(session: Session, table: Table, plan: boolean): void {
  const { emit } = session;
  const { columns, rows } = table;
  emit({ kind: 'rich', mime: 'application/vnd.opennote.table+json', data: JSON.stringify({ columns, rows }) });
  const summary = plan ? planTree(rows) : `${t('codeStudio.sqlLua.sql.rows', { count: table.count })}\n`;
  emit({ kind: 'out', stream: 'out', text: summary });
  if (table.cut) {
    emit({ kind: 'out', stream: 'err', text: `${t('codeStudio.sqlLua.sql.cut', { count: rows.length })}\n` });
  }
}

/** The error line the diagnostics mapper reads: `file:line:column: CODE: message`. */
function errorLine(file: RunFile, failure: SqlFailure): string {
  const { line, column } = lineColumn(file.text, failure.offset);
  return `${file.path}:${line}:${column}: ${failure.code}: ${failure.message}\n`;
}

export function importCsv(
  session: Pick<Session, 'db' | 'loud' | 'emit'>,
  files: readonly RunFile[],
  line: string,
): void {
  const usage = () => new Error(t('codeStudio.sqlLua.sql.importUsage'));
  const words = line.split(/\s+/).slice(1);
  let skip: number | null = null;
  if (words[0] === '--skip') {
    skip = Number.parseInt(words[1] ?? '', 10);
    if (!Number.isInteger(skip) || skip < 0) throw usage();
    words.splice(0, 2);
  }
  const [path, table] = words;
  if (!path || !table || words.length !== 2) throw usage();
  const file = files.find((candidate) => candidate.path === path.replace(/^\.\//, ''));
  if (!file) throw new Error(t('codeStudio.sqlLua.sql.importNoFile', { path }));
  const rows = parseCsv(file.text);
  if (rows.length === 0) throw new Error(t('codeStudio.sqlLua.sql.importEmpty', { path }));
  const { db } = session;
  const exists = db.selectValue('select count(*) from sqlite_master where type = ? and name = ? collate nocase', [
    'table',
    table,
  ]);
  // As in SQLite's shell: a new table takes its column names from the first row; an existing one keeps all rows.
  let first = 1;
  if (!exists) {
    const names = rows.shift()!;
    const columns = names.map((name) => `${quoteIdentifier(name)} TEXT`).join(', ');
    db.exec(`create table ${quoteIdentifier(table)} (${columns})`);
    first = 2;
  } else if (skip !== null) {
    rows.splice(0, skip);
    first = skip + 1;
  }
  const width = Number(db.selectValue('select count(*) from pragma_table_info(?)', [table]));
  const insert = `insert into ${quoteIdentifier(table)} values (${Array(width).fill('?').join(', ')})`;
  db.exec('begin');
  try {
    rows.forEach((row, index) => {
      if (row.length !== width) {
        const params = { path, line: first + index, found: row.length, table, expected: width };
        throw new Error(t('codeStudio.sqlLua.sql.importBadRow', params));
      }
      db.exec({ sql: insert, bind: row });
    });
    db.exec('commit');
  } catch (error) {
    db.exec('rollback');
    throw error;
  }
  if (session.loud) {
    const text = t('codeStudio.sqlLua.sql.imported', { count: rows.length, table });
    session.emit({ kind: 'out', stream: 'out', text: `${text}\n` });
  }
}

/** The words after SQLite's "sqlite3 result code N:" prefix, which oo1 puts on its errors. */
function plainMessage(error: unknown): { code: string; message: string } {
  const text = error instanceof Error ? error.message : String((error as { message?: unknown }).message);
  const found = /^(SQLITE_\w+): (?:sqlite3 result code \d+: )?([\s\S]*)$/.exec(text);
  const given = (error as { code?: string }).code;
  return { code: given ?? found?.[1] ?? 'SQLITE_ERROR', message: found?.[2] ?? text };
}

/** Runs one file. Throws Stop for an error, the time limit, or memory. */
function runFile(session: Session, file: RunFile, files: readonly RunFile[]): void {
  const { s3, db, emit, context } = session;
  const { capi } = s3;
  const check = () => {
    if (performance.now() > context.deadline) throw new Stop({ status: 'time', message: '' });
  };
  const fail = (failure: SqlFailure): never => {
    if (session.stopped) throw new Stop({ status: session.stopped, message: failure.code });
    emit({ kind: 'out', stream: 'err', text: errorLine(file, failure) });
    const status = failure.code === 'SQLITE_NOMEM' ? 'memory' : 'error';
    throw new Stop({ status, ...(status === 'error' ? { exitCode: 1 } : {}), message: failure.code });
  };
  const atStatement = (start: number, text: string) => start + (/\S/.exec(text)?.index ?? 0);
  walk(s3, db, file.text, {
    statement(stmt, start, text) {
      check();
      try {
        const table = collect(s3, db, stmt, check);
        if (!session.loud) return;
        if (table.columns.length > 0) show(session, table, isPlan(text));
        else if (/^\s*(insert|update|delete|replace)\b/i.test(text) && capi.sqlite3_changes(db.pointer!) > 0) {
          const count = capi.sqlite3_changes(db.pointer!);
          emit({ kind: 'out', stream: 'out', text: `${t('codeStudio.sqlLua.sql.changed', { count })}\n` });
        }
      } catch (error) {
        if (error instanceof Stop) throw error;
        return fail({ ...plainMessage(error), offset: atStatement(start, text) });
      }
    },
    directive(line, start) {
      try {
        if (!line.startsWith('.import')) {
          throw new Error(t('codeStudio.sqlLua.sql.unknownCommand', { command: line.split(/\s+/)[0] ?? line }));
        }
        importCsv(session, files, line);
      } catch (error) {
        if (error instanceof Stop) throw error;
        fail({ ...plainMessage(error), offset: start });
      }
    },
    failure: fail,
  });
}

/**
 * SQLite calls this every 10,000 steps of a statement. It ends the statement at the time limit, and when the
 * WebAssembly heap has grown past the memory limit (SQLite has no heap cap in this build).
 */
function limitHandler(session: Session, memoryBytes: number): number {
  const { s3, db, context } = session;
  const baseline = s3.wasm.heap8u().byteLength;
  const handler = s3.wasm.installFunction('i(p)', () => {
    if (performance.now() > context.deadline) session.stopped = 'time';
    else if (s3.wasm.heap8u().byteLength > baseline + memoryBytes) session.stopped = 'memory';
    return session.stopped ? 1 : 0;
  });
  s3.capi.sqlite3_progress_handler(db.pointer!, 10_000, handler, 0);
  return handler;
}

/** Runs the request: setup files quietly, then the main file. */
export function runSql(s3: Sqlite3Static, request: RunRequest, emit: Emit, context: RunContext): RunEnd {
  const db = openDatabase(s3);
  // No string or blob may be longer than a quarter of the memory limit, so one doubling expression cannot fill it.
  s3.capi.sqlite3_limit(db.pointer!, s3.capi.SQLITE_LIMIT_LENGTH, Math.floor(request.limits.memoryBytes / 4));
  const session: Session = { s3, db, emit, context, loud: false, stopped: null };
  const handler = limitHandler(session, request.limits.memoryBytes);
  try {
    for (const file of setupFiles(request.files, request.main)) runFile(session, file, request.files);
    const main = request.files.find((file) => file.path === request.main);
    if (!main) return { status: 'failed', message: request.main };
    session.loud = true;
    runFile(session, main, request.files);
    return { status: 'ok', message: '' };
  } catch (error) {
    if (error instanceof Stop) return error.end;
    throw error;
  } finally {
    s3.capi.sqlite3_progress_handler(db.pointer!, 0, 0, 0);
    s3.wasm.uninstallFunction(handler);
    db.close();
  }
}
