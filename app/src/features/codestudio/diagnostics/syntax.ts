// Layer L-a: syntax errors from the Lezer tree (DESIGN 6.1). Lezer marks each place it could not parse with an error
// node. This turns those places into messages that say more than "syntax error" where the context allows. It names
// a bracket that is never closed and the line it opened on, a closing bracket with no opener, a Python block header
// without its colon, and the end of the file reached too early.

import type { SyntaxNode, Tree } from '@lezer/common';
import { lineAt, lineRange, lineStarts } from './text';
import type { EditorLanguage, Finding } from './types';

/** At most this many syntax errors per file: after the first few, the rest are mostly echoes. */
export const MAX_SYNTAX_ERRORS = 10;

const OPAQUE = /String|Comment|Char|Template|Regex|Docstring|Literal$/;
const BRACKETS = new Set(['(', ')', '[', ']', '{', '}']);
const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const PY_HEADER = /^(?:async\s+)?(if|elif|else|while|for|def|class|try|except|finally|with|match|case)\b(?!\s*[=.])/;

/**
 * Ranges the bracket scan skips. Only a bracket token of the tree, or a bracket inside an error node, counts. So every
 * other leaf token is skipped: a regex, a rune, a macro body, a text block, or a quoted identifier holds text, not
 * code. Strings, comments, and templates are skipped whole, with the parts inside them.
 */
function opaqueRanges(tree: Tree): [number, number][] {
  const ranges: [number, number][] = [];
  const cursor = tree.cursor();
  for (;;) {
    const error = cursor.type.isError;
    const literal =
      !error && OPAQUE.test(cursor.name) && cursor.name !== 'BooleanLiteral' && cursor.name !== 'NullLiteral';
    if (literal) ranges.push([cursor.from, cursor.to]);
    else if (cursor.firstChild()) continue;
    else if (!error && cursor.to > cursor.from && !BRACKETS.has(cursor.name)) ranges.push([cursor.from, cursor.to]);
    while (!cursor.nextSibling()) if (!cursor.parent()) return ranges;
  }
}

/** Brackets that do not pair up. Strings and comments do not count. */
export function bracketFindings(text: string, tree: Tree): Finding[] {
  const skip = opaqueRanges(tree);
  const starts = lineStarts(text);
  const stack: { char: string; at: number }[] = [];
  const found: Finding[] = [];
  let r = 0;
  for (let i = 0; i < text.length; i += 1) {
    while (r < skip.length && skip[r][1] <= i) r += 1;
    if (r < skip.length && skip[r][0] <= i) {
      i = skip[r][1] - 1;
      continue;
    }
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') stack.push({ char: ch, at: i });
    else if (ch in PAIRS) {
      const open = stack.pop();
      if (!open) {
        found.push({
          from: i,
          to: i + 1,
          severity: 'error',
          code: 'syntax',
          message: 'unexpectedClose',
          params: { close: ch },
        });
      } else if (open.char !== PAIRS[ch]) {
        found.push({
          from: i,
          to: i + 1,
          severity: 'error',
          code: 'syntax',
          message: 'mismatched',
          params: { close: ch, open: open.char, line: lineAt(starts, open.at) },
        });
        return found;
      }
    }
  }
  for (const open of stack.reverse()) {
    found.push({
      from: open.at,
      to: open.at + 1,
      severity: 'error',
      code: 'syntax',
      message: 'unclosed',
      params: { open: open.char, line: lineAt(starts, open.at) },
    });
  }
  return found;
}

/**
 * Reads one line of Python code: the code before its comment, and whether it has a `:` outside brackets and strings.
 * `if n < 2: return n` has one; `x = d[1:2]` and `f"{a:3}"` do not. A walrus `:=` is not a colon.
 */
function scanPythonLine(line: string): { code: string; colon: boolean } {
  let depth = 0;
  let quote = '';
  let colon = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return { code: line.slice(0, i).trimEnd(), colon };
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0 && line[i + 1] !== '=') colon = true;
  }
  return { code: line.trimEnd(), colon };
}

/** True when Lezer read the line starting at `at` as part of a match statement. */
function inMatch(tree: Tree, at: number): boolean {
  for (let node: SyntaxNode | null = tree.resolveInner(at, 1); node; node = node.parent) {
    if (node.name === 'MatchStatement') return true;
  }
  return false;
}

/**
 * A Python block header that lacks its colon, as the keyword and the line's end. The header is the error's line or
 * the line before it. It counts only when it has no `:` of its own and the error sits at the end of its code, or
 * after it but before the next token. A `match` or `case` line counts only when Lezer read a match statement.
 */
function missingColon(
  text: string,
  tree: Tree,
  starts: readonly number[],
  at: number,
): { keyword: string; at: number } | null {
  const line = lineAt(starts, at);
  for (const candidate of [line, line - 1]) {
    if (candidate < 1) continue;
    const { from, to } = lineRange(text, starts, candidate);
    const { code, colon } = scanPythonLine(text.slice(from, to));
    const match = PY_HEADER.exec(code.trimStart());
    if (!match || colon || /[([{,\\]$/.test(code)) continue;
    const end = from + code.length;
    const next = end + (/^\s*/.exec(text.slice(end))?.[0].length ?? 0);
    if (at < end || at > next) continue;
    const keyword = match[1];
    if ((keyword === 'match' || keyword === 'case') && !inMatch(tree, from + code.length - code.trimStart().length)) {
      continue;
    }
    return { keyword, at: end };
  }
  return null;
}

function describe(text: string, tree: Tree, language: EditorLanguage, starts: readonly number[], at: number): Finding {
  if (language === 'python') {
    const colon = missingColon(text, tree, starts, at);
    if (colon) {
      const from = Math.max(0, colon.at - 1);
      return {
        from,
        to: colon.at,
        severity: 'error',
        code: 'syntax',
        message: 'expectedColon',
        params: { keyword: colon.keyword },
      };
    }
  }
  if (at >= text.trimEnd().length) {
    const end = text.trimEnd().length;
    return { from: Math.max(0, end - 1), to: end, severity: 'error', code: 'syntax', message: 'endOfFile' };
  }
  const token = /^(?:\w+|\S)/.exec(text.slice(at).replace(/^[ \t]+/, ''));
  if (!token || token[0] === '\n') {
    return { from: at, to: Math.min(text.length, at + 1), severity: 'error', code: 'syntax', message: 'syntax' };
  }
  const from = at + (text.slice(at).length - text.slice(at).replace(/^[ \t]+/, '').length);
  return {
    from,
    to: from + token[0].length,
    severity: 'error',
    code: 'syntax',
    message: 'syntaxAt',
    params: { token: token[0] },
  };
}

/** The syntax errors in a parsed file, at most MAX_SYNTAX_ERRORS and at most one per line. */
export function syntaxFindings(text: string, tree: Tree, language: EditorLanguage): Finding[] {
  const brackets = bracketFindings(text, tree);
  if (brackets.length) return brackets.slice(0, MAX_SYNTAX_ERRORS);
  const starts = lineStarts(text);
  const lines = new Set<number>();
  const found: Finding[] = [];
  tree.iterate({
    enter(node) {
      if (found.length >= MAX_SYNTAX_ERRORS) return false;
      if (!node.type.isError) return true;
      const finding = describe(text, tree, language, starts, node.from);
      const line = lineAt(starts, finding.from);
      if (!lines.has(line)) {
        lines.add(line);
        found.push(finding);
      }
      return false;
    },
  });
  return found;
}
