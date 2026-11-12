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
import { say } from './say';
import { runProgram } from './wasi';

/** The console's own lines, in the error stream and gray (SGR 90), so they stand apart from the program's output. */
const phase = (text: string) => `\u001b[90m${text}\u001b[39m\n`;

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

/**
 * The compile step: one clang command over every source of the language. Its own lines and clang's messages go to
 * the error stream. Returns the program, or null when the compile failed.
 */
function compile(
  clang: Clang,
  language: ClangLanguage,
  request: RunRequest,
  emit: Emit,
  options: ClangOptions,
): Uint8Array | null {
  const sources = sourcesOf(language, request.files, request.main);
  const err = (text: string) => emit({ kind: 'out', stream: 'err', text });
  const standard = standardName(standardOf(language, options));
  err(phase(say(codeStudioCpp.phase.compiling, { files: sources.join(', '), version: clang.version, standard })));
  const started = performance.now();
  const command = language === 'cpp' ? 'clang++' : 'clang';
  const result = clang.run(command, compileArgs(language, sources, request.limits, options), request.files);
  if (result.text !== '') err(result.text.endsWith('\n') ? result.text : `${result.text}\n`);
  const program = result.code === 0 ? fileAt(result.files, OUTPUT) : null;
  if (!program) {
    err(phase(codeStudioCpp.phase.failed));
    return null;
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
        throw new Error(missing ? codeStudioCpp.packMissing : codeStudioCpp.startFailed, { cause: error });
      }
      adapter.version = `clang ${clang.version}`;
    },

    async prepare(request: RunRequest, emit: Emit): Promise<RunEnd | null> {
      if (sourcesOf(language, request.files, request.main).length === 0) {
        return { status: 'error', message: codeStudioCpp.noSources };
      }
      program = compile(clang, language, request, emit, options);
      return program ? null : { status: 'error', message: 'compile' };
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
