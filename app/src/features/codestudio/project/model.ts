// Reading a code project from a block's data, and its limits (DESIGN 3.1). The page may hold a project from a
// newer or older version, or one another app changed, so every read fills what is missing instead of trusting it.

import { CODE_PROJECT_VERSION, PROJECT_LANGUAGES, RUNTIME_IDS } from '../contracts';
import type { CodeFile, CodeProject, CodeProjectSettings, ProjectLanguage, TestCase } from '../contracts';

export const DEFAULT_SETTINGS: CodeProjectSettings = { timeMs: 10_000, memoryMb: 64, tabSize: 4 };

/** The lowest and highest value of each run setting. A read clamps to them, so no page holds a run without bounds. */
export const SETTINGS_RANGE: Record<keyof CodeProjectSettings, readonly [number, number]> = {
  timeMs: [100, 600_000],
  memoryMb: [16, 4096],
  tabSize: [1, 8],
};

/** The longest project name, in characters. */
export const NAME_CHARS = 256;

/** Export file names at the project's root. A project file cannot take them, so an export never loses one. */
export const RESERVED_ROOT_FILES = ['opennote-project.json', 'opennote-tests.json'] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** A setting within its range, a whole number, or the default when it is not a finite number. */
function setting(value: unknown, key: keyof CodeProjectSettings): number {
  const [low, high] = SETTINGS_RANGE[key];
  return Math.min(high, Math.max(low, Math.round(num(value, DEFAULT_SETTINGS[key]))));
}

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

function readFiles(value: unknown): Record<string, CodeFile> {
  const files: Record<string, CodeFile> = {};
  if (!isObject(value)) return files;
  for (const [id, file] of Object.entries(value)) {
    if (!isObject(file) || typeof file.path !== 'string') continue;
    files[id] = { path: file.path, text: str(file.text), order: num(file.order, 0) };
  }
  return files;
}

function readTests(value: unknown): Record<string, TestCase> {
  const tests: Record<string, TestCase> = {};
  if (!isObject(value)) return tests;
  for (const [id, test] of Object.entries(value)) {
    if (isObject(test)) tests[id] = { ...(test as unknown as TestCase), id };
  }
  return tests;
}

/** The project in a block's data, with defaults for every missing or malformed field. */
export function readProject(data: Record<string, unknown>): CodeProject {
  const language = PROJECT_LANGUAGES.includes(data.language as ProjectLanguage)
    ? (data.language as ProjectLanguage)
    : 'python';
  const runtime = data.runtime === 'toolchain' || RUNTIME_IDS.includes(data.runtime as never) ? data.runtime : null;
  const settings = isObject(data.settings) ? data.settings : {};
  return {
    v: num(data.v, 1),
    minEditor: num(data.minEditor, 1),
    name: str(data.name),
    language,
    runtime: (runtime ?? (language === 'python' ? 'python-quick' : 'toolchain')) as CodeProject['runtime'],
    main: str(data.main),
    files: readFiles(data.files),
    stdin: str(data.stdin),
    args: Array.isArray(data.args) ? data.args.filter((arg): arg is string => typeof arg === 'string') : [],
    tests: readTests(data.tests),
    settings: {
      timeMs: setting(settings.timeMs, 'timeMs'),
      memoryMb: setting(settings.memoryMb, 'memoryMb'),
      tabSize: setting(settings.tabSize, 'tabSize'),
    },
  };
}

/**
 * Whether this app may edit the project. A project whose `minEditor` is above the data version this app writes
 * came from a newer app: it is shown read-only with its fallback, and never patched (ADR 0069).
 */
export function canEdit(data: Record<string, unknown>): boolean {
  const minEditor = data.minEditor;
  return !(typeof minEditor === 'number' && minEditor > CODE_PROJECT_VERSION);
}

const encoder = new TextEncoder();

/** The size of text in UTF-8, the unit of the limits. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/** The project's text in UTF-8 bytes, counted over its files. */
export function projectBytes(files: Record<string, CodeFile>): number {
  let total = 0;
  for (const file of Object.values(files)) total += utf8Bytes(file.text);
  return total;
}

/** The files in tree order: by `order`, then by path. */
export function sortedFiles(files: Record<string, CodeFile>): [string, CodeFile][] {
  return Object.entries(files).sort(([, a], [, b]) => a.order - b.order || (a.path < b.path ? -1 : 1));
}

/** The next free ID with the prefix (`f01`, `f02`, … for files, `t01`, … for tests). */
export function nextId(prefix: string, taken: Record<string, unknown>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}${String(n).padStart(2, '0')}`;
    if (!(id in taken)) return id;
  }
}

/** The order after every file's. */
export function nextOrder(files: Record<string, CodeFile>): number {
  return Object.values(files).reduce((max, file) => Math.max(max, file.order + 1), 0);
}

/** A fresh project with one main file. */
export function starterProject(name: string, mainText: string): CodeProject {
  return {
    v: CODE_PROJECT_VERSION,
    minEditor: 1,
    name,
    language: 'python',
    runtime: 'python-quick',
    main: 'f01',
    files: { f01: { path: 'main.py', text: mainText, order: 0 } },
    stdin: '',
    args: [],
    tests: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}
