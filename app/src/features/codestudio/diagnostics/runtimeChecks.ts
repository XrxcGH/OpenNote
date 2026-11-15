// The engine checks of the runtimes in this build (layer L-c, DESIGN 6.1). Python's check is compile() in full
// Python (Pyodide, so CPython's own parser): quick Python (MicroPython) does not know every CPython form, so it would
// mark good code. The runtime loads on the first check, not before. Without the full Python pack the check finds
// nothing, and the Lezer and OpenNote layers still run. SQL asks SQLite to prepare each statement against the
// project's schema, and Lua asks wasmoon's load(). C and C++ run clang -fsyntax-only in clang's own check worker
// (runtimes/cpp/checker.ts), never on the page thread. Each runtime loads on its first check. The studio calls
// registerRuntimeChecks once, next to createDiagnostics.

import type { RuntimeAdapter } from '../contracts';
import { fromRuntimeAdapter, registerEngineCheck, type EngineCheck } from './engine';

const loadFullPython = (): Promise<RuntimeAdapter> =>
  import('../runtimes/python').then((loaded) => loaded.pythonFullAdapter);

/** Python's engine check. `load` gives the adapter whose `check` runs compile(); by default full Python. */
export function pythonEngineCheck(load: () => Promise<RuntimeAdapter> = loadFullPython): EngineCheck {
  return {
    id: 'pyodide',
    layer: 'engine',
    languages: ['python'],
    async check(file, files) {
      try {
        const check = fromRuntimeAdapter(await load(), ['python'], 'pyodide');
        return check ? await check.check(file, files) : [];
      } catch {
        // A missing pack, or a runtime that failed to start: no engine marks.
        return [];
      }
    },
  };
}

/** A runtime's engine check that loads the runtime on its first check. A runtime that fails to start marks nothing. */
function lazyCheck(
  id: string,
  languages: EngineCheck['languages'],
  load: () => Promise<EngineCheck['check']>,
  layer: EngineCheck['layer'] = 'engine',
): EngineCheck {
  return {
    id,
    layer,
    languages,
    async check(file, files) {
      try {
        return await (
          await load()
        )(file, files);
      } catch {
        return [];
      }
    },
  };
}

const adapterCheck = (adapter: Promise<RuntimeAdapter>) =>
  adapter.then((loaded) => {
    const check = loaded.check?.bind(loaded);
    if (!check) throw new Error('no check');
    return check;
  });

/** SQL's engine check: SQLite prepares each statement against the project's schema. */
export const sqlEngineCheck = (): EngineCheck =>
  lazyCheck('sqlite', ['sql'], () => adapterCheck(import('../runtimes/sql/adapter').then((m) => m.sqlAdapter)));

/** Lua's engine check: wasmoon's load() says whether the file compiles. */
export const luaEngineCheck = (): EngineCheck =>
  lazyCheck('wasmoon', ['lua'], () => adapterCheck(import('../runtimes/lua/adapter').then((m) => m.luaAdapter)));

let clangCheck: Promise<EngineCheck['check']> | null = null;

/** C and C++'s compiler check: one ClangChecker, so clang's check worker stays warm between checks. */
export const clangCompilerCheck = (): EngineCheck =>
  lazyCheck(
    'clang',
    ['c', 'cpp'],
    () =>
      (clangCheck ??= import('../runtimes/cpp/checker').then((m) => {
        const check = m.clangEngineCheck(new m.ClangChecker());
        return check.check.bind(check);
      })),
    'compiler',
  );

/** Registers every runtime's engine check. Returns the way to remove them. */
export function registerRuntimeChecks(load?: () => Promise<RuntimeAdapter>): () => void {
  const removers = [pythonEngineCheck(load), sqlEngineCheck(), luaEngineCheck(), clangCompilerCheck()].map(
    registerEngineCheck,
  );
  return () => removers.forEach((remove) => remove());
}
