// The C and C++ runtimes (DESIGN 2.1, runtimes `c` and `cpp`). A run has two phases with their own console lines.
//
// The compile phase is prepare(). It compiles and links the sources with clang for wasm32-wasip1. The flags are
// -std=c17 or -std=c++20, -Wall -Wextra, -O1 -g. It runs before `started`, under its own compile limit (COMPILE_MS),
// and its lines reach the console as they are printed.
//
// The run phase is run(). It runs the program with the WASI shim (wasi.ts), under the time limit.
//
// clang's messages go to the console as it prints them, and to the editor through clangMapper. check() is the live
// compiler check (layer L-e).

import type {
  Emit,
  RunContext,
  RunEnd,
  RunFile,
  RunRequest,
  RuntimeAdapter,
  RuntimeDiagnostic,
} from '../../contracts/run';
import { codeStudioCpp } from '../../../../strings/en/codeStudio/cpp';
import { ALLOWANCES } from '../../run/adapters';
import { Clang, fileAt } from './clang';
import { clangMapper } from './diagnostics';
import { type ClangLanguage, type ClangOptions, OUTPUT, checkArgs, compileArgs, sourcesOf, standardOf } from './flags';
import { phase, say } from './say';
import { runProgram } from './wasi';

const STANDARD_NAMES: Record<string, string> = { 'c++20': 'C++20', 'c++17': 'C++17', 'c++23': 'C++23' };
const standardName = (standard: string) => STANDARD_NAMES[standard] ?? standard.toUpperCase();

/** argv[0]: the main file's name without its folder or extension, as a native build would name the program. */
export function programName(main: string): string {
  const base = main.slice(main.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export interface ClangAdapter extends RuntimeAdapter {
  check(file: RunFile, files: RunFile[]): Promise<RuntimeDiagnostic[]>;
}

/** clang's error for throw or try, which the pack's libc++ cannot support (it is built without exceptions). */
const EXCEPTIONS = /with exceptions disabled/;

/**
 * The compile step: one clang command over every source of the language. Its own lines and clang's messages go to
 * the error stream. Returns the program, or how the run ends when the compile failed (message `compile`) or clang
 * itself stopped (message `compiler-stopped`).
 */
function compile(
  clang: Clang,
  language: ClangLanguage,
  request: RunRequest,
  emit: Emit,
  options: ClangOptions,
): Uint8Array | RunEnd {
  const sources = sourcesOf(language, request.files, request.main);
  const err = (text: string) => emit({ kind: 'out', stream: 'err', text });
  const standard = standardName(standardOf(language, options));
  err(phase(say(codeStudioCpp.phase.compiling, { files: sources.join(', '), version: clang.version, standard })));
  const started = performance.now();
  const command = language === 'cpp' ? 'clang++' : 'clang';
  let result: ReturnType<Clang['run']>;
  try {
    result = clang.run(command, compileArgs(language, sources, request.limits, options), request.files);
  } catch {
    return { status: 'failed', message: 'compiler-stopped' };
  }
  if (result.text !== '') err(result.text.endsWith('\n') ? result.text : `${result.text}\n`);
  const program = result.code === 0 ? fileAt(result.files, OUTPUT) : null;
  if (!program) {
    if (language === 'cpp' && EXCEPTIONS.test(result.text)) err(phase(codeStudioCpp.noExceptions));
    err(phase(codeStudioCpp.phase.failed));
    return { status: 'error', message: 'compile' };
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(2);
  err(phase(say(codeStudioCpp.phase.compiled, { seconds })));
  return program;
}

/** One runtime over a shared Clang, so C and C++ in one worker load the pack once. */
export function clangAdapter(language: ClangLanguage, clang: Clang, options: ClangOptions = {}): ClangAdapter {
  let program: Uint8Array | null = null;

  const adapter: ClangAdapter = {
    id: language,
    pack: 'clang',
    allowances: ALLOWANCES[language],
    version: '',
    async load(onProgress) {
      try {
        await clang.load(onProgress);
      } catch (error) {
        const missing = error instanceof TypeError || /import|fetch|module/i.test(String(error));
        // A code: the page shows its sentence as the status line (run/summary.ts).
        throw new Error(missing ? 'pack-missing' : 'start-failed', { cause: error });
      }
      adapter.version = `clang ${clang.version}`;
    },

    async prepare(request: RunRequest, emit: Emit): Promise<RunEnd | null> {
      if (sourcesOf(language, request.files, request.main).length === 0) {
        return { status: 'error', message: 'no-sources' };
      }
      const compiled = compile(clang, language, request, emit, options);
      program = compiled instanceof Uint8Array ? compiled : null;
      return program ? null : (compiled as RunEnd);
    },

    async run(request: RunRequest, emit: Emit, context: RunContext): Promise<RunEnd> {
      const prepared = program ? null : await adapter.prepare!(request, emit, context);
      if (prepared || !program) return prepared ?? { status: 'error', message: 'compile' };
      const wasm = program;
      program = null;
      const args = [programName(request.main), ...request.args];
      const interactive = context.stdin.interactive;
      return runProgram(wasm, { args, memoryBytes: request.limits.memoryBytes, interactive }, emit, context);
    },

    diagnostics: clangMapper,

    async check(file: RunFile, files: RunFile[]): Promise<RuntimeDiagnostic[]> {
      const all = [file, ...files.filter((other) => other.path !== file.path)];
      const command = language === 'cpp' ? 'clang++' : 'clang';
      const result = clang.run(command, checkArgs(language, file.path, options), all);
      return clangMapper.map(result.text, all);
    },
  };
  return adapter;
}
