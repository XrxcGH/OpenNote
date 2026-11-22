// SQL errors as editor diagnostics (DESIGN 4.6 and 6.1, layer L-c). A run's error text maps through the pattern
// below. `checkSql` finds errors without running the file's queries: it prepares each statement with
// sqlite3_prepare_v2 against the schema the project's other .sql files make, and the statement's own earlier changes.
// A check has a short time limit, so a file that loops or fills a table cannot hold the check worker.

import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { RunFile, RuntimeDiagnostic } from '../../contracts/run';
import { patternMapper } from '../../run/diagnostics';
import { importCsv, openDatabase, setupFiles } from './engine';
import type { Db } from './engine';
import { lineColumn, walk } from './walk';

/** `file:line:column: SQLITE_CODE: message`, the line the SQL engine prints for an error. */
export const sqlMapper = patternMapper([
  {
    pattern: /^(?<file>[^:\n]+):(?<line>\d+):(?<column>\d+): (?<kind>SQLITE_\w+): (?<message>.*)$/m,
    fallbackKind: 'SQLITE_ERROR',
  },
]);

/** How long one check may spend running statements, in milliseconds. The goal for a check is under 50. */
export const CHECK_MS = 150;

/** The longest string or blob a check allows, so one doubling expression cannot fill the heap. */
const CHECK_LENGTH = 1_000_000;

/** Only statements that change the schema run in the checked file. Changes to rows do not matter to a check. */
const SCHEMA_STATEMENT = /^(?:\s|--[^\n]*|\/\*[\s\S]*?\*\/)*(?:create|alter|drop)\b/i;

/** The `.import` line's table, made as the run makes it. A failure there is the run's to report, not the check's. */
function importQuietly(db: Db, files: readonly RunFile[], line: string): void {
  if (!line.startsWith('.import')) return;
  try {
    importCsv({ db, loud: false, emit: () => undefined }, files, line);
  } catch {
    // The run reports it.
  }
}

/** Runs a script's statements without stopping at an error, and without showing results. */
function quietly(s3: Sqlite3Static, db: Db, file: RunFile, files: readonly RunFile[]) {
  walk(s3, db, file.text, {
    statement(stmt) {
      s3.capi.sqlite3_step(stmt);
    },
    directive: (line) => importQuietly(db, files, line),
    failure: () => true,
  });
}

/**
 * The errors in `file`. Schema and seed files run first so the file's queries see their tables. A statement that
 * changes the schema runs, so a later statement sees the table it creates; other statements are only prepared.
 * Everything that runs stops at CHECK_MS.
 */
export function checkSql(s3: Sqlite3Static, file: RunFile, files: readonly RunFile[]): RuntimeDiagnostic[] {
  const db = openDatabase(s3);
  const found: RuntimeDiagnostic[] = [];
  s3.capi.sqlite3_limit(db.pointer!, s3.capi.SQLITE_LIMIT_LENGTH, CHECK_LENGTH);
  const deadline = performance.now() + CHECK_MS;
  const handler = s3.wasm.installFunction('i(p)', () => (performance.now() > deadline ? 1 : 0));
  s3.capi.sqlite3_progress_handler(db.pointer!, 1000, handler, 0);
  try {
    for (const setup of setupFiles(files, file.path)) quietly(s3, db, setup, files);
    walk(s3, db, file.text, {
      statement(stmt, _start, text) {
        if (SCHEMA_STATEMENT.test(text) && s3.capi.sqlite3_column_count(stmt) === 0) s3.capi.sqlite3_step(stmt);
      },
      directive: (line) => importQuietly(db, files, line),
      failure(failure) {
        const { line, column } = lineColumn(file.text, failure.offset);
        found.push({ file: file.path, line, column, message: failure.message, kind: failure.code });
        return true;
      },
    });
  } finally {
    s3.capi.sqlite3_progress_handler(db.pointer!, 0, 0, 0);
    s3.wasm.uninstallFunction(handler);
    db.close();
  }
  return found;
}
