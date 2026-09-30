// Splits source code into comments (checked as prose) and code (checked for structure).
// A small scanner is enough here: it understands strings, line comments and block comments.

import type { ProseLine } from './types.ts';

interface Syntax {
  line: string[];
  blockStart?: string;
  blockEnd?: string;
  quotes: string[];
}

const C_LIKE: Syntax = { line: ['//'], blockStart: '/*', blockEnd: '*/', quotes: ['"', "'", '`'] };
const HASH: Syntax = { line: ['#'], quotes: ['"', "'"] };
const CSS: Syntax = { line: [], blockStart: '/*', blockEnd: '*/', quotes: ['"', "'"] };
const MARKUP: Syntax = { line: [], blockStart: '<!--', blockEnd: '-->', quotes: [] };

const SYNTAX_BY_EXT: Record<string, Syntax> = {
  ts: C_LIKE,
  tsx: C_LIKE,
  js: C_LIKE,
  jsx: C_LIKE,
  mjs: C_LIKE,
  cjs: C_LIKE,
  rs: C_LIKE,
  cs: C_LIKE,
  java: C_LIKE,
  kt: C_LIKE,
  swift: C_LIKE,
  dart: C_LIKE,
  go: C_LIKE,
  c: C_LIKE,
  h: C_LIKE,
  cpp: C_LIKE,
  hpp: C_LIKE,
  css: CSS,
  scss: C_LIKE,
  py: HASH,
  sh: HASH,
  bash: HASH,
  ps1: HASH,
  yml: HASH,
  yaml: HASH,
  toml: HASH,
  rb: HASH,
  html: MARKUP,
  xml: MARKUP,
  vue: MARKUP,
  svelte: MARKUP,
};

export const CODE_EXTENSIONS = Object.keys(SYNTAX_BY_EXT);

export interface SplitResult {
  comments: ProseLine[];
  code: string[];
}

type Mode = { kind: 'code' } | { kind: 'string'; quote: string } | { kind: 'block' };

/** Returns comment text as prose lines, plus the code with comments and strings blanked out. */
export function splitCode(lines: string[], ext: string): SplitResult {
  const syntax = SYNTAX_BY_EXT[ext] ?? C_LIKE;
  const comments: ProseLine[] = [];
  const code: string[] = [];
  let mode: Mode = { kind: 'code' };
  lines.forEach((raw, index) => {
    const result = scanLine(raw, syntax, mode, ext);
    mode = result.mode;
    code.push(result.code);
    const text = cleanComment(result.comment);
    if (text !== '') comments.push({ line: index + 1, raw, text, context: 'comment' });
  });
  return { comments, code };
}

interface LineScan {
  code: string;
  comment: string;
  mode: Mode;
}

/** One line being scanned, with the language details the scanner needs. */
interface LineInput {
  raw: string;
  syntax: Syntax;
  ext: string;
}

const JS_FAMILY = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']);

function scanLine(raw: string, syntax: Syntax, startMode: Mode, ext: string): LineScan {
  const input: LineInput = { raw, syntax, ext };
  let mode = startMode;
  let code = '';
  let comment = '';
  let i = 0;
  while (i < raw.length) {
    const step = scanStep(input, i, mode, code);
    code += step.code;
    comment += step.comment;
    mode = step.mode;
    if (step.restIsComment) {
      comment += raw.slice(step.next);
      code += ' '.repeat(raw.length - step.next);
      break;
    }
    i = step.next;
  }
  // Single and double quoted strings don't continue past the end of a line.
  if (mode.kind === 'string' && mode.quote !== '`' && !raw.endsWith('\\')) mode = { kind: 'code' };
  return { code, comment, mode };
}

interface Step {
  code: string;
  comment: string;
  mode: Mode;
  next: number;
  restIsComment?: boolean;
}

function scanStep(input: LineInput, i: number, mode: Mode, codeSoFar: string): Step {
  const { raw, syntax } = input;
  if (mode.kind === 'block') return scanBlock(raw, i, syntax);
  if (mode.kind === 'string') return scanString(raw, i, mode);
  const lineMarker = syntax.line.find((marker) => raw.startsWith(marker, i));
  if (lineMarker) {
    return { code: blank(lineMarker), comment: '', mode, next: i + lineMarker.length, restIsComment: true };
  }
  if (syntax.blockStart && raw.startsWith(syntax.blockStart, i)) {
    return { code: blank(syntax.blockStart), comment: '', mode: { kind: 'block' }, next: i + syntax.blockStart.length };
  }
  const char = raw[i];
  if (char === '/' && JS_FAMILY.has(input.ext) && regexAllowed(codeSoFar)) return scanRegex(raw, i, mode);
  if (syntax.quotes.includes(char) && !isRustLifetime(raw, i, input.ext)) {
    return { code: char, comment: '', mode: { kind: 'string', quote: char }, next: i + 1 };
  }
  return { code: char, comment: '', mode, next: i + 1 };
}

function blank(text: string): string {
  return ' '.repeat(text.length);
}

// A slash starts a regular expression (not a division) after an operator, a bracket or a keyword.
function regexAllowed(codeSoFar: string): boolean {
  const trimmed = codeSoFar.trimEnd();
  return trimmed === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(trimmed) || /\b(return|typeof|case|in|of)$/.test(trimmed);
}

/** Skips a regex literal, keeping its slashes so code structure stays intact. */
function scanRegex(raw: string, i: number, mode: Mode): Step {
  let inClass = false;
  for (let j = i + 1; j < raw.length; j++) {
    const char = raw[j];
    if (char === '\\') j++;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) return { code: `/${' '.repeat(j - i - 1)}/`, comment: '', mode, next: j + 1 };
  }
  return { code: '/', comment: '', mode, next: i + 1 };
}

function scanBlock(raw: string, i: number, syntax: Syntax): Step {
  const end = syntax.blockEnd ?? '*/';
  if (raw.startsWith(end, i)) return { code: blank(end), comment: ' ', mode: { kind: 'code' }, next: i + end.length };
  return { code: ' ', comment: raw[i], mode: { kind: 'block' }, next: i + 1 };
}

function scanString(raw: string, i: number, mode: { kind: 'string'; quote: string }): Step {
  const char = raw[i];
  if (char === '\\') return { code: '  ', comment: '', mode, next: i + 2 };
  if (char === mode.quote) return { code: char, comment: '', mode: { kind: 'code' }, next: i + 1 };
  return { code: ' ', comment: '', mode, next: i + 1 };
}

// In Rust, 'a is a lifetime, not the start of a character literal.
function isRustLifetime(raw: string, i: number, ext: string): boolean {
  if (ext !== 'rs' || raw[i] !== "'") return false;
  return !/^'(\\.|[^'\\])'/.test(raw.slice(i));
}

function cleanComment(comment: string): string {
  return comment
    .replace(/^\s*[/*!#<>-]+\s?/, '')
    .replace(/\*\/\s*$/, '')
    .replace(/`[^`]*`/g, '§')
    .replace(/https?:\/\/[^\s)]+/g, ' ')
    .trim();
}
