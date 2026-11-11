// What the studio knows about each language: its name, the editor language of a file, the badge in the tabs and
// the file tree, which in-app runtimes run it, and which pack a runtime needs first (ADR 0070).

import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import type { PackId, ProjectLanguage, RuntimeId } from '../contracts';
import type { EditorLanguage } from '../editor/indent';
import { fenceLanguage } from '../project/fallback';

const EDITOR_LANGUAGES = new Set<string>([
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
]);

/** The editor language of a project file, by its name. */
export function fileLanguage(path: string): EditorLanguage {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name === 'Makefile' || name === 'makefile' || name === 'GNUmakefile' || name.endsWith('.mk')) return 'makefile';
  const fence = fenceLanguage(path);
  return EDITOR_LANGUAGES.has(fence) ? (fence as EditorLanguage) : 'plain';
}

/** A language's name, as people write it. */
export function languageName(language: EditorLanguage): string {
  if (language === 'makefile') return t('codeStudio.studio.makefile');
  if (language === 'plain' || language === 'scheme') return t('codeStudio.studio.plainText');
  return t(`codeStudio.project.languages.${language}` as MessageKey);
}

/** The short badge a tab and the file tree show, by editor language. Two or three letters, as file icons do. */
const BADGES: Partial<Record<EditorLanguage, string>> = {
  python: 'PY',
  javascript: 'JS',
  typescript: 'TS',
  sql: 'SQL',
  lua: 'LUA',
  c: 'C',
  cpp: 'C++',
  ruby: 'RB',
  r: 'R',
  java: 'JV',
  kotlin: 'KT',
  csharp: 'C#',
  go: 'GO',
  rust: 'RS',
  swift: 'SW',
  dart: 'DT',
  bash: 'SH',
  powershell: 'PS',
  php: 'PHP',
  julia: 'JL',
  makefile: 'MK',
};

export const badgeOf = (language: EditorLanguage): string => BADGES[language] ?? 'TXT';

/** The in-app runtimes of each language, the first one the default. Others run through a toolchain (R3). */
export const RUNTIMES: Partial<Record<ProjectLanguage, readonly RuntimeId[]>> = {
  python: ['python-quick', 'python-full'],
  javascript: ['javascript'],
  typescript: ['typescript'],
  sql: ['sql'],
  lua: ['lua'],
  c: ['c'],
  cpp: ['cpp'],
  ruby: ['ruby'],
  r: ['r'],
};

/** The pack a runtime needs before its first run, or none for a bundled one. */
export const RUNTIME_PACKS: Partial<Record<RuntimeId, PackId>> = {
  'python-full': 'pyodide',
  c: 'clang',
  cpp: 'clang',
  ruby: 'ruby',
  r: 'webr',
};

/** The runtime's name in the picker. */
export function runtimeName(runtime: RuntimeId | 'toolchain'): string {
  const key = runtime === 'python-quick' ? 'pythonQuick' : runtime === 'python-full' ? 'pythonFull' : runtime;
  return t(`codeStudio.studio.runtimes.${key}` as MessageKey);
}

/** The main file's name for a new project in a language. */
export const MAIN_FILES: Record<ProjectLanguage, string> = {
  python: 'main.py',
  javascript: 'main.js',
  typescript: 'main.ts',
  sql: 'main.sql',
  lua: 'main.lua',
  c: 'main.c',
  cpp: 'main.cpp',
  ruby: 'main.rb',
  r: 'main.R',
  java: 'Main.java',
  kotlin: 'Main.kt',
  csharp: 'Program.cs',
  go: 'main.go',
  rust: 'main.rs',
  swift: 'main.swift',
  dart: 'main.dart',
  bash: 'main.sh',
  powershell: 'main.ps1',
  php: 'main.php',
  julia: 'main.jl',
};
