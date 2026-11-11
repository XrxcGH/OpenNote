// The JavaScript and TypeScript runtimes behind the RuntimeAdapter contract (DESIGN 2.1, 4). Both load QuickJS
// (quickjs-emscripten-core and @jitl/quickjs-wasmfile-release-sync, MIT, already shipped for code cells) and Sucrase
// (MIT) in a warm worker, before lockdown. They differ only in their name and version line: a project may mix
// .js and .ts files under either one.

import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import type { RuntimeAdapter } from '../../contracts/run';
import { ALLOWANCES } from '../../run/adapters';
import { quickjsMapper } from './diagnostics';
import { runProgram } from './engine';
import type { Engine } from './engine';

/** The pinned versions in package.json (a unit test keeps them equal). */
export const VERSIONS = { quickjs: '0.32.0', sucrase: '3.35.1' } as const;

let engine: Engine | null = null;

async function loadEngine(onProgress: (percent: number) => void): Promise<Engine> {
  if (engine) return engine;
  onProgress(10);
  const quickjs = await newQuickJSWASMModuleFromVariant(newVariant(releaseSync, { wasmLocation: wasmUrl }));
  onProgress(70);
  const { transform } = await import('sucrase');
  engine = { quickjs, transform };
  return engine;
}

function adapter(id: 'javascript' | 'typescript', version: string): RuntimeAdapter {
  return {
    id,
    version,
    allowances: ALLOWANCES[id],
    diagnostics: quickjsMapper,
    async load(onProgress) {
      await loadEngine(onProgress);
    },
    async run(request, emit, context) {
      return runProgram(await loadEngine(() => undefined), request, emit, context);
    },
  };
}

export const javascriptAdapter = adapter('javascript', `QuickJS (quickjs-emscripten ${VERSIONS.quickjs})`);
export const typescriptAdapter = adapter(
  'typescript',
  `TypeScript through Sucrase ${VERSIONS.sucrase}, QuickJS (quickjs-emscripten ${VERSIONS.quickjs})`,
);
