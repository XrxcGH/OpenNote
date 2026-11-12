// Walks an SQL script one statement at a time with sqlite3_prepare_v2, the way SQLite's own shell does. Each
// statement is prepared against the database as it is at that moment, so a CREATE TABLE earlier in the script is
// there for the SELECT after it. A prepare error comes with sqlite3_error_offset, a byte offset into the statement's
// text, which this file turns into a character offset in the whole script (SQLite counts UTF-8 bytes).

import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

type Db = InstanceType<Sqlite3Static['oo1']['DB']>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** What SQLite said about a statement it would not prepare or run. */
export interface SqlFailure {
  /** The result code's name, such as SQLITE_ERROR. */
  code: string;
  message: string;
  /** Character offset in the script of the place SQLite points to, or of the statement when it gives none. */
  offset: number;
}

export interface Handlers {
  /** A prepared statement at `start` (a character offset); return false to stop. The walker finalizes it. */
  statement(stmt: number, start: number, text: string): boolean | void;
  /** A line that starts with a dot, such as `.import`; return false to stop. */
  directive?(line: string, start: number): boolean | void;
  /** A statement that would not prepare; return true to go on with the next statement. */
  failure(failure: SqlFailure): boolean;
}

/** 1-based line and column of a character offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - (before.lastIndexOf('\n') + 1) + 1 };
}

/** The failure for SQLite's latest error on `db`; `base` is the character offset of the text that was prepared. */
export function failureOf(s3: Sqlite3Static, db: Db, rc: number, base: number, prepared: Uint8Array): SqlFailure {
  const { capi } = s3;
  const bytes = capi.sqlite3_error_offset(db.pointer!);
  const message = capi.sqlite3_errmsg(db.pointer!);
  let chars = bytes >= 0 ? decoder.decode(prepared.subarray(0, bytes)).length : 0;
  if (bytes < 0) {
    // SQLite gives no place for a missing table or column, so look for its name in the statement.
    const name = /^no such \w+: (?:\w+\.)?(\w+)/.exec(message)?.[1];
    const found = name ? new RegExp(`\\b${name}\\b`).exec(decoder.decode(prepared)) : null;
    chars = found?.index ?? 0;
  }
  return { code: capi.sqlite3_js_rc_str(rc) ?? 'SQLITE_ERROR', message, offset: base + chars };
}

/** Where to go on after a statement that failed to prepare: just past the next semicolon. */
function skipPast(text: string, from: number): number {
  const semicolon = text.indexOf(';', from);
  return semicolon === -1 ? text.length : semicolon + 1;
}

export function walk(s3: Sqlite3Static, db: Db, text: string, handlers: Handlers): void {
  const { capi, wasm } = s3;
  const [stmtOut, tailOut] = wasm.allocPtr(2, false) as [number, number];
  try {
    let at = 0;
    while (at < text.length) {
      const first = /\S/.exec(text.slice(at));
      if (!first) return;
      at += first.index;
      if (text[at] === '.' && handlers.directive) {
        const end = text.indexOf('\n', at);
        const stop = end === -1 ? text.length : end;
        if (handlers.directive(text.slice(at, stop).trim(), at) === false) return;
        at = stop;
        continue;
      }
      const bytes = encoder.encode(text.slice(at));
      const pointer = wasm.alloc(bytes.length + 1);
      let consumed = 0;
      try {
        wasm.heap8u().set(bytes, pointer);
        wasm.poke8(pointer + bytes.length, 0);
        wasm.pokePtr(stmtOut, 0);
        wasm.pokePtr(tailOut, 0);
        const rc = capi.sqlite3_prepare_v2(db.pointer!, pointer, bytes.length, stmtOut, tailOut);
        const stmt = wasm.peekPtr(stmtOut) as number;
        if (rc !== 0) {
          const failure = failureOf(s3, db, rc, at, bytes);
          if (stmt) capi.sqlite3_finalize(stmt);
          if (!handlers.failure(failure)) return;
          at = skipPast(text, Math.max(failure.offset, at));
          continue;
        }
        consumed = decoder.decode(bytes.subarray(0, (wasm.peekPtr(tailOut) as number) - pointer)).length;
        if (stmt) {
          try {
            if (handlers.statement(stmt, at, text.slice(at, at + consumed)) === false) return;
          } finally {
            capi.sqlite3_finalize(stmt);
          }
        }
      } finally {
        wasm.dealloc(pointer);
      }
      if (consumed === 0) return;
      at += consumed;
    }
  } finally {
    wasm.dealloc(stmtOut);
    wasm.dealloc(tailOut);
  }
}
