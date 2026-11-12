// C and C++ as the run worker loads them (run/adapters.ts): both runtimes share one clang from the `clang` pack
// (ADR 0070), so a worker fetches and compiles it once.
import { packFileUrl } from '../../packs/client';
import { clangAdapter } from './adapter';
import { Clang, type ClangModule } from './clang';

/** The pack's bundle.js. Its own files (llvm.core.wasm, llvm-resources.tar) load from next to it. */
export const importPackClang = (): Promise<ClangModule> =>
  import(/* @vite-ignore */ packFileUrl('clang/bundle.js')) as Promise<ClangModule>;

const clang = new Clang(importPackClang);

export const cAdapter = clangAdapter('c', clang);
export const cppAdapter = clangAdapter('cpp', clang);

export { clangAdapter, programName } from './adapter';
export { Clang } from './clang';
export type { ClangModule, ImportClang } from './clang';
export { HEADER_HINTS, headerFor, includeHint } from './headers';
export { STANDARDS } from './flags';
export type { ClangLanguage, ClangOptions } from './flags';
