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

const SPACE = new Set([9, 10, 11, 12, 13, 32]);

/**
 * Where a statement that failed to prepare ends: just past the first semicolon at or after `from` that is not inside
 * a string, a quoted name, or a comment. The scan starts at the statement's `start`, so quotes are read right.
 */
export function statementEnd(bytes: Uint8Array, start: number, from: number): number {
  let at = start;
  while (at < bytes.length) {
    const byte = bytes[at]!;
    if (byte === 0x27 || byte === 0x22 || byte === 0x60 || byte === 0x5b) {
      const close = byte === 0x5b ? 0x5d : byte;
      at += 1;
      // A doubled quote inside a quoted text closes and reopens at once, so the same scan reads it.
      while (at < bytes.length && bytes[at] !== close) at += 1;
      at += 1;
    } else if (byte === 0x2d && bytes[at + 1] === 0x2d) {
      while (at < bytes.length && bytes[at] !== 10) at += 1;
    } else if (byte === 0x2f && bytes[at + 1] === 0x2a) {
      at += 2;
      while (at < bytes.length && !(bytes[at] === 0x2a && bytes[at + 1] === 0x2f)) at += 1;
      at += 2;
    } else {
      if (byte === 0x3b && at >= from) return at + 1;
      at += 1;
    }
  }
  return bytes.length;
}

/**
 * Walks `text` statement by statement. The text is encoded and copied into the WebAssembly heap once, and each
 * prepare call starts where the last one ended (the pzTail it returns), so the work grows with the script's size and
 * not with its square. Byte offsets turn into character offsets only as the walk moves along.
 */
export function walk(s3: Sqlite3Static, db: Db, text: string, handlers: Handlers): void {
  const { capi, wasm } = s3;
  const [stmtOut, tailOut] = wasm.allocPtr(2, false) as [number, number];
  const bytes = encoder.encode(text);
  const pointer = wasm.alloc(bytes.length + 1);
  try {
    wasm.heap8u().set(bytes, pointer);
    wasm.poke8(pointer + bytes.length, 0);
    let byteAt = 0;
    let charAt = 0;
    /** Moves the position to byte `to`, keeping the character offset in step. */
    const moveTo = (to: number) => {
      charAt += decoder.decode(bytes.subarray(byteAt, to)).length;
      byteAt = to;
    };
    while (byteAt < bytes.length) {
      while (byteAt < bytes.length && SPACE.has(bytes[byteAt]!)) moveTo(byteAt + 1);
      if (byteAt >= bytes.length) return;
      const start = byteAt;
      const startChar = charAt;
      if (bytes[start] === 0x2e && handlers.directive) {
        let stop = start;
        while (stop < bytes.length && bytes[stop] !== 10) stop += 1;
        const line = decoder.decode(bytes.subarray(start, stop)).trim();
        if (handlers.directive(line, startChar) === false) return;
        moveTo(stop);
        continue;
      }
      wasm.pokePtr(stmtOut, 0);
      wasm.pokePtr(tailOut, 0);
      const rc = capi.sqlite3_prepare_v2(db.pointer!, pointer + start, bytes.length - start, stmtOut, tailOut);
      const stmt = wasm.peekPtr(stmtOut) as number;
      if (rc !== 0) {
        const end = statementEnd(bytes, start, start);
        const failure = failureOf(s3, db, rc, startChar, bytes.subarray(start, end));
        if (stmt) capi.sqlite3_finalize(stmt);
        if (!handlers.failure(failure)) return;
        // Go on after the statement's end, but not before the place SQLite pointed to.
        const pointedAt = start + encoder.encode(text.slice(startChar, Math.max(failure.offset, startChar))).length;
        moveTo(statementEnd(bytes, start, pointedAt));
        continue;
      }
      const tail = (wasm.peekPtr(tailOut) as number) - pointer;
      if (tail <= start) {
        if (stmt) capi.sqlite3_finalize(stmt);
        return;
      }
      if (stmt) {
        try {
          if (handlers.statement(stmt, startChar, decoder.decode(bytes.subarray(start, tail))) === false) return;
        } finally {
          capi.sqlite3_finalize(stmt);
        }
      }
      moveTo(tail);
    }
  } finally {
    wasm.dealloc(pointer);
    wasm.dealloc(stmtOut);
    wasm.dealloc(tailOut);
  }
}
