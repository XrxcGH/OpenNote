// What a code cell stores and which runtime runs it (docs/help/code-cells.md). A cell's data is its language and
// code. Data version 2 adds more languages and the Python engine; a cell that needs it carries `minEditor: 2`, so an
// older app shows it read-only instead of relabeling it.
import type { RunLimits, RuntimeId } from '../codestudio';

export const LANGUAGES = ['python', 'javascript', 'typescript', 'sql', 'lua', 'c', 'cpp'] as const;
export type CodeLanguage = (typeof LANGUAGES)[number];

export const isLanguage = (value: unknown): value is CodeLanguage =>
  typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);

/** The two Python engines: MicroPython, which is bundled, and the full one, which is a download. */
export type PythonEngine = 'python-quick' | 'python-full';
export const isPythonEngine = (value: unknown): value is PythonEngine =>
  value === 'python-quick' || value === 'python-full';

/** The newest cell format this app edits (a cell's `minEditor` above it came from a newer app). */
export const KNOWN_EDITOR = 2;

/** The languages data version 1 knew. */
const VERSION_ONE: readonly CodeLanguage[] = ['python', 'javascript'];

/** The file name a cell's code has when it runs, and for the checkers. */
export const FILE_NAMES: Record<CodeLanguage, string> = {
  python: 'main.py',
  javascript: 'main.js',
  typescript: 'main.ts',
  sql: 'main.sql',
  lua: 'main.lua',
  c: 'main.c',
  cpp: 'main.cpp',
};

/** The runtime that runs a language. */
export function runtimeOf(language: CodeLanguage, engine: PythonEngine = 'python-quick'): RuntimeId {
  return language === 'python' ? engine : language;
}

/** The format version a cell needs: 2 for the newer languages and the full Python engine, else 1. */
export function minEditorOf(language: CodeLanguage, engine: PythonEngine = 'python-quick'): 1 | 2 {
  return VERSION_ONE.includes(language) && engine === 'python-quick' ? 1 : 2;
}

/**
 * A cell from a newer app: a language this app does not run, or a format it does not know. It is shown as it is
 * stored and never changed, so an older app cannot relabel it as Python. `known` is the newest format the reader
 * knows; tests pass 1 to simulate an older app.
 */
export function needsNewerApp(data: Record<string, unknown>, known: number = KNOWN_EDITOR): boolean {
  const { language, minEditor } = data;
  if (language !== undefined && !isLanguage(language)) return true;
  if (typeof minEditor === 'number' && minEditor > known) return true;
  // An older app does not know the newer languages at all.
  return known < 2 && isLanguage(language) && !VERSION_ONE.includes(language);
}

/**
 * How long, how large, and how much a cell may run, use, and print. The same values as the run core's page limits
 * (run.test.tsx checks it), written here so this file loads without the run chunk.
 */
export const LIMITS: RunLimits = {
  timeMs: 10_000,
  loadMs: 20_000,
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 512 * 1024,
  outputChars: 100_000,
  sourceChars: 200_000,
};
export type Limits = RunLimits;
