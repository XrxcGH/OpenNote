// SQL errors as editor diagnostics (DESIGN 4.6 and 6.1, layer L-c). A run's error text maps through the pattern
// below. `checkSql` finds errors without running the file's queries: it prepares each statement with
// sqlite3_prepare_v2 against the schema the project's other .sql files make, and the statement's own earlier changes.

import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { RunFile, RuntimeDiagnostic } from '../../contracts/run';
import { patternMapper } from '../../run/diagnostics';
import { openDatabase, setupFiles } from './engine';
import { lineColumn, walk } from './walk';

/** `file:line:column: SQLITE_CODE: message`, the line the SQL engine prints for an error. */
export const sqlMapper = patternMapper([
  {
    pattern: /^(?<file>[^:\n]+):(?<line>\d+):(?<column>\d+): (?<kind>SQLITE_\w+): (?<message>.*)$/m,
    fallbackKind: 'SQLITE_ERROR',
  },
]);

/** Runs a script's statements without stopping at an error, and without showing results. */
function quietly(s3: Sqlite3Static, db: ReturnType<typeof openDatabase>, file: RunFile) {
  walk(s3, db, file.text, {
    statement(stmt) {
      s3.capi.sqlite3_step(stmt);
    },
    failure: () => true,
  });
}

/**
 * The errors in `file`. Schema and seed files run first so the file's queries see their tables. A statement that
 * changes the database runs, so a later statement sees the table it creates; a query is only prepared.
 */
export function checkSql(s3: Sqlite3Static, file: RunFile, files: readonly RunFile[]): RuntimeDiagnostic[] {
  const db = openDatabase(s3);
  const found: RuntimeDiagnostic[] = [];
  try {
    for (const setup of setupFiles(files, file.path)) quietly(s3, db, setup);
    walk(s3, db, file.text, {
      statement(stmt) {
        if (s3.capi.sqlite3_stmt_readonly(stmt) === 0 && s3.capi.sqlite3_column_count(stmt) === 0) {
          s3.capi.sqlite3_step(stmt);
        }
      },
      directive: () => true,
      failure(failure) {
        const { line, column } = lineColumn(file.text, failure.offset);
        found.push({ file: file.path, line, column, message: failure.message, kind: failure.code });
        return true;
      },
    });
  } finally {
    db.close();
  }
  return found;
}
