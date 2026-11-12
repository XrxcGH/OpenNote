// The SQL runtime behind the RuntimeAdapter contract (DESIGN 2.1, 4): SQLite 3.54.1 as WebAssembly
// (@sqlite.org/sqlite-wasm, Apache-2.0; SQLite itself is public domain), loaded in a warm worker before lockdown.

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import type { RuntimeAdapter } from '../../contracts/run';
import { ALLOWANCES } from '../../run/adapters';
import { checkSql, sqlMapper } from './diagnostics';
import { runSql } from './engine';

/** The package types its start function without options, but it takes the Emscripten module options. */
const initModule = sqlite3InitModule as unknown as (options: {
  locateFile?: (name: string) => string;
  print: () => void;
  printErr: () => void;
}) => Promise<Sqlite3Static>;

let loaded: Promise<Sqlite3Static> | null = null;

/** SQLite, loaded once per worker. Output and errors from its own code go nowhere. */
function load(): Promise<Sqlite3Static> {
  loaded ??= initModule({
    locateFile: (name: string) => (name.endsWith('.wasm') ? wasmUrl : name),
    print: () => undefined,
    printErr: () => undefined,
  });
  return loaded;
}

/**
 * SQLite's JavaScript code tests `x instanceof Function`, and the run worker's lockdown removes the global named
 * Function (it makes code from text). This puts back a stand-in that only supports that test: its prototype is the real
 * Function.prototype, whose constructor lockdown has already replaced with a function that throws. Calling the
 * stand-in throws too, so no code can be made from text through it.
 */
export function restoreFunctionTest(scope: object = globalThis): void {
  if (typeof (scope as { Function?: unknown }).Function === 'function') return;
  const standIn = function Function(): never {
    throw new TypeError('Code cannot be made from text in a run.');
  };
  standIn.prototype = Object.getPrototypeOf(() => undefined) as object;
  Object.defineProperty(scope, 'Function', { value: standIn, writable: false, configurable: true });
}

export const sqlAdapter: RuntimeAdapter = {
  id: 'sql',
  version: 'SQLite 3.54.1',
  allowances: ALLOWANCES.sql,
  diagnostics: sqlMapper,
  async load(onProgress) {
    onProgress(10);
    await load();
  },
  async run(request, emit, context) {
    restoreFunctionTest();
    return runSql(await load(), request, emit, context);
  },
  async check(file, files) {
    restoreFunctionTest();
    return checkSql(await load(), file, files);
  },
};
