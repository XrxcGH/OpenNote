// The Lua runtime behind the RuntimeAdapter contract (DESIGN 2.1, 4): Lua 5.4 through wasmoon 1.16.0 (MIT),
// loaded in a warm worker before lockdown. The WebAssembly module is shared; each run builds its own Lua state.

import { LuaFactory } from 'wasmoon';
import wasmUrl from 'wasmoon/dist/glue.wasm?url';
import type { RuntimeAdapter } from '../../contracts/run';
import { ALLOWANCES } from '../../run/adapters';
import { luaMapper } from './diagnostics';
import { checkLua, runLua } from './engine';

/** The pinned version in package.json (a unit test keeps them equal). */
export const WASMOON_VERSION = '1.16.0';

let factory: LuaFactory | null = null;

async function loaded(): Promise<LuaFactory> {
  if (!factory) {
    factory = new LuaFactory(wasmUrl);
    await factory.getLuaModule();
  }
  return factory;
}

export const luaAdapter: RuntimeAdapter = {
  id: 'lua',
  version: `Lua 5.4 (wasmoon ${WASMOON_VERSION})`,
  allowances: ALLOWANCES.lua,
  diagnostics: luaMapper,
  async load(onProgress) {
    onProgress(10);
    await loaded();
  },
  async run(request, emit, context) {
    return runLua(await loaded(), request, emit, context);
  },
  /** Lua's own `load` says whether the file compiles. */
  async check(file) {
    return checkLua(await loaded(), file);
  },
};
