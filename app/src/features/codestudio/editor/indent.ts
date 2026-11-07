// Tab and Shift+Tab in every code editor, the studio's and the code cells' (DESIGN 5.3.1, owner decision of
// 2026-11-01). Tab indents and never accepts a suggestion. Shift+Tab outdents.
//
// The indent unit per language: Python 4 spaces (PEP 8); JavaScript and TypeScript 2; C, C++, Java, C#, Kotlin,
// Swift, Rust (rustfmt), PHP, and PowerShell 4; SQL, Lua, Ruby, R, and Dart 2. Go (gofmt) and Makefiles (make needs
// a tab before each recipe line) use a tab character whatever the spaces setting says. A setting for the language
// wins; otherwise a file that already indents one way keeps it.

import { EditorSelection, countColumn } from '@codemirror/state';
import type { ChangeSpec, EditorState, Line, SelectionRange, TransactionSpec } from '@codemirror/state';

/** The languages the editor knows, the project languages plus a few file kinds. */
export type EditorLanguage =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'sql'
  | 'lua'
  | 'c'
  | 'cpp'
  | 'ruby'
  | 'r'
  | 'java'
  | 'kotlin'
  | 'csharp'
  | 'go'
  | 'rust'
  | 'swift'
  | 'dart'
  | 'bash'
  | 'powershell'
  | 'php'
  | 'julia'
  | 'scheme'
  | 'makefile'
  | 'plain';

export interface IndentStyle {
  /** Columns per indent stop. */
  size: number;
  /** Tab inserts a tab character. */
  tabs: boolean;
}

const FOUR: IndentStyle = { size: 4, tabs: false };
const TWO: IndentStyle = { size: 2, tabs: false };
const TAB: IndentStyle = { size: 4, tabs: true };

export const DEFAULT_INDENT: Readonly<Record<EditorLanguage, IndentStyle>> = {
  python: FOUR,
  javascript: TWO,
  typescript: TWO,
  c: FOUR,
  cpp: FOUR,
  java: FOUR,
  csharp: FOUR,
  kotlin: FOUR,
  swift: FOUR,
  rust: FOUR,
  php: FOUR,
  powershell: FOUR,
  sql: TWO,
  lua: TWO,
  ruby: TWO,
  r: TWO,
  dart: TWO,
  bash: TWO,
  julia: FOUR,
  scheme: TWO,
  go: TAB,
  makefile: TAB,
  plain: FOUR,
};

/** Languages whose tools require a tab character. */
const TAB_ONLY = new Set<EditorLanguage>(['go', 'makefile']);

/**
 * How a file already indents, or null when it doesn't say: tabs when most indented lines start with one, else the
 * most common step between consecutive indented lines (VS Code's indentation detection does the same).
 */
export function detectIndent(text: string): IndentStyle | null {
  let tabLines = 0;
  let spaceLines = 0;
  const steps = new Map<number, number>();
  let previous = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const lead = /^[ \t]*/.exec(line)?.[0] ?? '';
    if (lead.startsWith('\t')) tabLines++;
    else if (lead.length > 0) spaceLines++;
    if (!lead.includes('\t')) {
      const step = Math.abs(lead.length - previous);
      if (step > 1 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
      previous = lead.length;
    }
  }
  if (tabLines === 0 && spaceLines === 0) return null;
  if (tabLines > spaceLines) return { size: 4, tabs: true };
  let best = 0;
  let count = 0;
  for (const [step, seen] of steps) if (seen > count || (seen === count && step < best)) [best, count] = [step, seen];
  return best ? { size: best, tabs: false } : null;
}

/** The person's setting for a language: { tabSize, insertSpaces }, as Settings.code.indent stores it. */
export interface IndentSetting {
  tabSize: number;
  insertSpaces: boolean;
}

/** The indent style for a file: Go and Makefile tabs, then the setting, then the file's own style, then the default. */
export function resolveIndent(language: EditorLanguage, text: string, setting?: IndentSetting): IndentStyle {
  const base = DEFAULT_INDENT[language];
  if (TAB_ONLY.has(language)) return { size: setting?.tabSize ?? base.size, tabs: true };
  if (setting) return { size: setting.tabSize, tabs: !setting.insertSpaces };
  return detectIndent(text) ?? base;
}

/** The text of one indent unit. */
export function unitText(style: IndentStyle): string {
  return style.tabs ? '\t' : ' '.repeat(style.size);
}

/** The lines a range touches. A selection that ends at the start of a line leaves that line out. */
function touchedLines(state: EditorState, range: SelectionRange): Line[] {
  const first = state.doc.lineAt(range.from);
  let last = state.doc.lineAt(range.to);
  if (!range.empty && range.to === last.from && last.number > first.number) last = state.doc.line(last.number - 1);
  const lines: Line[] = [];
  for (let n = first.number; n <= last.number; n++) lines.push(state.doc.line(n));
  return lines;
}

/**
 * Tab: an empty caret gets spaces up to the next indent stop (or one tab character); any selection indents every
 * line it touches by one unit and keeps the selected text. Every caret and selection is handled.
 */
export function indentSpec(state: EditorState, style: IndentStyle): TransactionSpec {
  const changes: ChangeSpec[] = [];
  const done = new Set<number>();
  for (const range of state.selection.ranges) {
    if (range.empty) {
      const line = state.doc.lineAt(range.head);
      const column = countColumn(line.text.slice(0, range.head - line.from), style.size);
      const insert = style.tabs ? '\t' : ' '.repeat(style.size - (column % style.size));
      changes.push({ from: range.head, insert });
      continue;
    }
    for (const line of touchedLines(state, range)) {
      if (done.has(line.number)) continue;
      done.add(line.number);
      changes.push({ from: line.from, insert: unitText(style) });
    }
  }
  const changeSet = state.changes(changes);
  // An insertion at a selection's start belongs inside it, so the indented text stays selected.
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) =>
      range.empty
        ? EditorSelection.cursor(changeSet.mapPos(range.head, 1))
        : EditorSelection.range(
            changeSet.mapPos(range.anchor, range.anchor <= range.head ? -1 : 1),
            changeSet.mapPos(range.head, range.head < range.anchor ? -1 : 1),
          ),
    ),
    state.selection.mainIndex,
  );
  return { changes: changeSet, selection, scrollIntoView: true, userEvent: 'input.indent' };
}

/** How many characters of leading whitespace make up one unit at the start of a line. */
function outdentLength(text: string, style: IndentStyle): number {
  if (text.startsWith('\t')) return 1;
  let length = 0;
  while (length < text.length && length < style.size && text[length] === ' ') length++;
  // Spaces short of a unit followed by a tab: the tab finishes the unit.
  if (length < style.size && text[length] === '\t') length++;
  return length;
}

/** Shift+Tab: every touched line loses at most one unit of leading whitespace, and nothing else. */
export function outdentSpec(state: EditorState, style: IndentStyle): TransactionSpec {
  const changes: ChangeSpec[] = [];
  const done = new Set<number>();
  for (const range of state.selection.ranges) {
    for (const line of touchedLines(state, range)) {
      if (done.has(line.number)) continue;
      done.add(line.number);
      const length = outdentLength(line.text, style);
      if (length > 0) changes.push({ from: line.from, to: line.from + length });
    }
  }
  return { changes, scrollIntoView: true, userEvent: 'delete.dedent' };
}
