// Reading helpers for the fixes: lines, the end of the code on a line, indentation, and the names a file declares.

import type { EditorLanguage } from '../diagnostics/types';

/** The file a fix reads. `files` holds the other files of the project (SQL schemas, headers). */
export interface FixContext {
  language: EditorLanguage;
  text: string;
  files?: readonly { path: string; text: string }[];
}

export interface Line {
  /** 1-based. */
  number: number;
  from: number;
  /** Without the line break. */
  to: number;
  text: string;
}

export function lineAtOffset(text: string, offset: number): Line {
  const at = Math.max(0, Math.min(offset, text.length));
  const from = text.lastIndexOf('\n', at - 1) + 1;
  let to = text.indexOf('\n', at);
  if (to < 0) to = text.length;
  if (to > from && text[to - 1] === '\r') to -= 1;
  let number = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < from; i = text.indexOf('\n', i + 1)) number += 1;
  return { number, from, to, text: text.slice(from, to) };
}

export function lineNumbered(text: string, number: number): Line | null {
  let from = 0;
  for (let n = 1; n < number; n += 1) {
    const next = text.indexOf('\n', from);
    if (next < 0) return null;
    from = next + 1;
  }
  return lineAtOffset(text, from);
}

/** The offset just past the code on a line: before trailing spaces and a trailing comment. */
export function codeEnd(line: Line, language: EditorLanguage): number {
  const marker = language === 'python' ? '#' : language === 'lua' ? '--' : language === 'sql' ? '--' : '//';
  let quote = '';
  let end = line.text.length;
  for (let i = 0; i < line.text.length; i += 1) {
    const ch = line.text[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || (ch === '`' && language !== 'python')) quote = ch;
    else if (line.text.startsWith(marker, i)) {
      end = i;
      break;
    }
  }
  return line.from + line.text.slice(0, end).trimEnd().length;
}

export function indentOf(text: string): string {
  return /^[ \t]*/.exec(text)![0];
}

/** The width of an indent with tabs counted as `tab` columns. */
export function indentWidth(indent: string, tab = 4): number {
  let width = 0;
  for (const ch of indent) width += ch === '\t' ? tab : 1;
  return width;
}

export const isBlank = (line: Line): boolean => line.text.trim() === '';

const WORD = '[\\p{L}_$][\\p{L}\\p{N}_$]*';

/** The offset of the whole word `word` nearest to `near`, within [from, to], or -1. */
export function findWord(text: string, word: string, from: number, to: number, near = from): number {
  const found: number[] = [];
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_$])${escaped}(?![\\p{L}\\p{N}_$])`, 'gu');
  const slice = text.slice(from, to);
  for (let m = pattern.exec(slice); m; m = pattern.exec(slice)) found.push(from + m.index);
  found.sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
  return found[0] ?? -1;
}

/** The names a file declares: functions, classes, variables, parameters, imports, and C declarations. */
export function declaredNames(text: string): Set<string> {
  const names = new Set<string>();
  const add = (name: string | undefined) => {
    if (name) names.add(name);
  };
  const rules: RegExp[] = [
    new RegExp(`\\b(?:def|class|function|const|let|var|local|fn|func|struct|enum|typedef)\\s+\\*?(${WORD})`, 'gu'),
    new RegExp(`^[ \\t]*(${WORD})\\s*(?::=|=)(?!=)`, 'gmu'),
    new RegExp(`\\b(?:int|char|float|double|long|short|void|bool|auto|size_t|string|unsigned)\\s+\\*?(${WORD})`, 'gu'),
    new RegExp(`\\bas\\s+(${WORD})`, 'gu'),
    new RegExp(`\\bfor\\s+(${WORD}(?:\\s*,\\s*${WORD})*)\\s+in\\b`, 'gu'),
  ];
  for (const rule of rules) {
    for (const m of text.matchAll(rule)) for (const part of (m[1] ?? '').split(',')) add(part.trim());
  }
  for (const m of text.matchAll(new RegExp(`^[ \\t]*import\\s+(${WORD})(?:\\.[\\w.]*)?\\s*$`, 'gmu'))) add(m[1]);
  for (const m of text.matchAll(new RegExp(`^[ \\t]*from\\s+[\\w.]+\\s+import\\s+([^\\n#]+)`, 'gmu'))) {
    for (const part of (m[1] ?? '').replace(/[()]/g, '').split(','))
      add(
        part
          .trim()
          .split(/\s+as\s+/)
          .pop(),
      );
  }
  for (const m of text.matchAll(/\b(?:def|function)\s*\w*\s*\(([^)\n]*)\)/g)) {
    for (const part of (m[1] ?? '').split(',')) add(/^\s*\*{0,2}([\p{L}_$][\p{L}\p{N}_$]*)/u.exec(part)?.[1]);
  }
  for (const m of text.matchAll(/\b(?:function\s*\w*|\w+)\s*\(([^)\n]*)\)\s*\{/g)) {
    for (const part of (m[1] ?? '').split(','))
      add(/(?:^|\s|\*|&)([\p{L}_$][\p{L}\p{N}_$]*)\s*$/u.exec(part.trim())?.[1]);
  }
  return names;
}

export { WORD };
