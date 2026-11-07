// The code project block (ADR 0069, DESIGN 3.1). Types and limits only: lane code:L02 writes the store, the
// path validator and the fallback over these shapes. A project lives in page.json, so every field here is part
// of the notebook format.

import type { RuntimeId } from './run';
import type { TestCase } from './testing';

/** The block type. The core keeps every ext:org.opennote/ block it does not know (spec 6.5). */
export const CODE_PROJECT_TYPE = 'ext:org.opennote/codeproject';

/** The data version this app writes. */
export const CODE_PROJECT_VERSION = 1;

/** Writer and reader limits (DESIGN 3.1). Over a limit, the app refuses the import and says why. */
export const PROJECT_LIMITS = {
  files: 200,
  pathChars: 255,
  fileBytes: 1024 * 1024,
  projectBytes: 4 * 1024 * 1024,
  tests: 500,
  fallbackBytes: 256 * 1024,
} as const;

/** Languages a project can hold. Tier 1 runs in the app; the rest run through installed toolchains (ADR 0071). */
export const PROJECT_LANGUAGES = [
  'python',
  'javascript',
  'typescript',
  'sql',
  'lua',
  'c',
  'cpp',
  'ruby',
  'r',
  'java',
  'kotlin',
  'csharp',
  'go',
  'rust',
  'swift',
  'dart',
  'bash',
  'powershell',
  'php',
  'julia',
] as const;
export type ProjectLanguage = (typeof PROJECT_LANGUAGES)[number];

/**
 * One file of a project. `path` follows the path rules of DESIGN 3.2 (relative, `/`-separated, NFC, unique
 * case-insensitively). `order` sorts the file tree. Binary files by asset reference are R2 and will widen this type.
 */
export interface CodeFile {
  path: string;
  text: string;
  order: number;
}

/** Per-project run settings. The studio fills the defaults when a field is missing. */
export interface CodeProjectSettings {
  timeMs: number;
  memoryMb: number;
  tabSize: number;
}

/**
 * The `data` of a code project block. `files` and `tests` are objects keyed by ID, never arrays. Block edits are
 * JSON merge patches (RFC 7396), which replace an array whole; a keyed object lets one file change alone.
 * Breakpoints, watches, tabs, and console history are device state keyed by block ID, never fields here.
 */
export interface CodeProject {
  /** The data version that wrote this project. */
  v: number;
  /** The oldest data version allowed to edit. A reader below it shows the block read-only with its fallback. */
  minEditor: number;
  name: string;
  language: ProjectLanguage;
  /** The in-app runtime, or `toolchain` for an installed one (ADR 0071). */
  runtime: RuntimeId | 'toolchain';
  /** The ID of the file that runs first. */
  main: string;
  files: Record<string, CodeFile>;
  /** Prefilled standard input (DESIGN 4.4). */
  stdin: string;
  args: string[];
  tests: Record<string, TestCase>;
  settings: CodeProjectSettings;
}

/** The whole block as page.json stores it. The fallback lists every file as a heading and a fenced block. */
export interface CodeProjectBlock {
  type: typeof CODE_PROJECT_TYPE;
  data: CodeProject;
  fallback: { markdown: string };
}
