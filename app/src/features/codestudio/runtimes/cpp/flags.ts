// The clang command lines for C and C++ (DESIGN 2.1 and 6.1). Programs build for wasm32-wasip1, the target the pack's
// clang uses by default. The project is mounted at PROJECT_DIR and clang works there. So its messages name project
// paths ("main.c:3:5: error: ..."), and a quoted include finds a file from the project's top folder.

import type { RunFile, RunLimits } from '../../contracts/run';

export type ClangLanguage = 'c' | 'cpp';

/** Where the project sits in the compiler's file tree, and where the program is written. */
export const PROJECT_DIR = '/project';
export const OUTPUT = '/build/main.wasm';

/** The language standards a person can pick (Settings, Code). The first of each is the default. */
export const STANDARDS = {
  c: ['c17', 'c11', 'c99', 'c23'],
  cpp: ['c++20', 'c++17', 'c++23'],
} as const satisfies Record<ClangLanguage, readonly string[]>;

const SOURCES: Record<ClangLanguage, RegExp> = {
  c: /\.c$/i,
  cpp: /\.(cpp|cc|cxx|c\+\+)$/i,
};
const HEADERS = /\.(h|hh|hpp|hxx|h\+\+|inc)$/i;

export interface ClangOptions {
  /** A value of STANDARDS for the language; anything else uses the default. */
  standard?: string;
  /** -Wall -Wextra, on unless turned off in Settings. */
  warnings?: boolean;
}

/** The standard clang gets: the one asked for when the list has it, else the language's default. */
export function standardOf(language: ClangLanguage, options: ClangOptions = {}): string {
  const list: readonly string[] = STANDARDS[language];
  return options.standard !== undefined && list.includes(options.standard) ? options.standard : list[0]!;
}

export function isSource(language: ClangLanguage, path: string): boolean {
  return SOURCES[language].test(path);
}

export function isHeader(path: string): boolean {
  return HEADERS.test(path);
}

/** The files to compile: the main file first, then every other source file of the language, by path. */
export function sourcesOf(language: ClangLanguage, files: readonly RunFile[], main: string): string[] {
  const others = files
    .map((file) => file.path)
    .filter((path) => path !== main && isSource(language, path))
    .sort();
  return isSource(language, main) ? [main, ...others] : others;
}

/** Flags shared by the compile and the check: the standard, the warnings, and no exceptions in C++. */
function common(language: ClangLanguage, options: ClangOptions): string[] {
  return [
    '-working-directory',
    PROJECT_DIR,
    `-std=${standardOf(language, options)}`,
    ...(options.warnings === false ? [] : ['-Wall', '-Wextra']),
    // The pack's libc++ and libc++abi are built without exceptions, so throw and try are compile errors.
    ...(language === 'cpp' ? ['-fno-exceptions'] : []),
    // clock() (C17 7.27.2.1) and <signal.h> come from wasi-libc's emulation libraries, linked in compileArgs.
    // POSIX names such as usleep stay hidden under a strict -std, as they are in a native strict build.
    '-D_WASI_EMULATED_PROCESS_CLOCKS',
    '-D_WASI_EMULATED_SIGNAL',
    '-fno-color-diagnostics',
    '-iquote',
    PROJECT_DIR,
  ];
}

const PAGE = 64 * 1024;

/**
 * The compile and link command. The stack comes first in memory, so a stack overflow traps instead of writing over
 * the program's data. Memory may grow to the run's limit and no further, so malloc returns NULL past it.
 */
export function compileArgs(
  language: ClangLanguage,
  sources: readonly string[],
  limits: Pick<RunLimits, 'memoryBytes' | 'stackBytes'>,
  options: ClangOptions = {},
): string[] {
  const maxMemory = Math.max(16, Math.floor(limits.memoryBytes / PAGE)) * PAGE;
  const stack = Math.min(Math.max(PAGE, Math.floor(limits.stackBytes / 16) * 16), maxMemory / 4);
  return [
    ...common(language, options),
    '-O1',
    '-g',
    ...sources,
    '-o',
    OUTPUT,
    '-Wl,--stack-first',
    `-Wl,-z,stack-size=${stack}`,
    `-Wl,--max-memory=${maxMemory}`,
    '-lwasi-emulated-process-clocks',
    '-lwasi-emulated-signal',
  ];
}

/** The live check of one file (layer L-e): parse and type-check only, with the same flags as a compile. */
export function checkArgs(language: ClangLanguage, path: string, options: ClangOptions = {}): string[] {
  const header = isHeader(path) ? ['-x', language === 'cpp' ? 'c++-header' : 'c-header'] : [];
  return ['-fsyntax-only', ...common(language, options), ...header, path];
}
