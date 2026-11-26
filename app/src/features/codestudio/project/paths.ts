// The path rules of a project's files (DESIGN 3.2). The same rules run in Rust before the tier-2 runner writes a
// project to disk (code:L16); both sides test against pathCases.json, so they refuse the same paths.

import { PROJECT_LIMITS } from '../contracts';

/** Why a path is refused. Each code has a message under codeStudio.project.refusal.path. */
export type PathProblem =
  | 'empty'
  | 'tooLong'
  | 'absolute'
  | 'backslash'
  | 'colon'
  | 'control'
  | 'reservedChar'
  | 'notNfc'
  | 'emptySegment'
  | 'dotSegment'
  | 'trailingDotOrSpace'
  | 'reserved'
  | 'duplicate'
  | 'folderClash';

/** Names Windows keeps for devices, with or without an extension (CON.py is CON). */
const RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/** Whether the text holds a C0 control, DEL, or a C1 control. */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Characters Windows refuses in a file name, beyond the ones above. */
const WINDOWS_CHARS = /[<>"|?*]/u;

/** Whether a folder or file name is a Windows device name. */
export function isReservedName(segment: string): boolean {
  const dot = segment.indexOf('.');
  return RESERVED.has((dot === -1 ? segment : segment.slice(0, dot)).toUpperCase());
}

/** The problem with one path on its own, or null when the path is allowed. */
export function pathProblem(path: string): PathProblem | null {
  if (path.length === 0) return 'empty';
  if ([...path].length > PROJECT_LIMITS.pathChars) return 'tooLong';
  if (path.startsWith('/')) return 'absolute';
  if (path.includes('\\')) return 'backslash';
  if (path.includes(':')) return 'colon';
  if (hasControl(path)) return 'control';
  if (WINDOWS_CHARS.test(path)) return 'reservedChar';
  if (path.normalize('NFC') !== path) return 'notNfc';
  for (const segment of path.split('/')) {
    if (segment.length === 0) return 'emptySegment';
    if (segment === '.' || segment === '..') return 'dotSegment';
    if (segment.endsWith('.') || segment.endsWith(' ')) return 'trailingDotOrSpace';
    if (isReservedName(segment)) return 'reserved';
  }
  return null;
}

/** The key two paths share when they name the same file on a disk that ignores letter case. */
export function pathKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

/**
 * The problem with `path` among the project's other paths, or null. Paths are unique case-insensitively, and a
 * file cannot sit where another path needs a folder (`a` and `a/b.py`), since a disk cannot hold both.
 */
export function pathProblemAmong(path: string, others: Iterable<string>): PathProblem | null {
  const own = pathProblem(path);
  if (own) return own;
  const key = pathKey(path);
  for (const other of others) {
    const otherKey = pathKey(other);
    if (otherKey === key) return 'duplicate';
    if (otherKey.startsWith(`${key}/`) || key.startsWith(`${otherKey}/`)) return 'folderClash';
  }
  return null;
}

/** The first problem in a whole set of paths, checked in order, or null when every path is allowed. */
export function pathsProblem(paths: readonly string[]): { path: string; problem: PathProblem } | null {
  for (let i = 0; i < paths.length; i++) {
    const problem = pathProblemAmong(paths[i], paths.slice(0, i));
    if (problem) return { path: paths[i], problem };
  }
  return null;
}
