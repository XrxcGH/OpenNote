// The quick fixes (DESIGN 7.1). Each rule is a pure function from one diagnostic and the file to the fixes it offers.
// A rule reads the diagnostic's message, which is the checker's sentence or the runtime's own, and the text around it.

import { t } from '../../../strings/t';
import { membersOf } from '../complete/members';
import type { Diagnostic, Fix, TextEdit } from '../contracts';
import { JS_GLOBALS } from '../diagnostics/jsGlobals';
import { PYTHON_BUILTINS } from '../diagnostics/pythonNames';
import { suggestions } from './distance';
import {
  codeEnd,
  declaredNames,
  eolOf,
  findWord,
  indentOf,
  indentWidth,
  isBlank,
  lineAtOffset,
  lineNumbered,
  WORD,
  type FixContext,
  type Line,
} from './source';
import { C_FUNCTIONS, headerFor, LUA_GLOBALS, PYTHON_IMPORTS } from './tables';

/** The kinds of fix, for "fix all of one kind in a file". */
export const FIX_KINDS = [
  'didYouMean',
  'addImport',
  'closeBracket',
  'closeQuote',
  'fixIndent',
  'addColon',
  'addSemicolon',
  'equalsToCompare',
  'addSelf',
  'addInclude',
  'sqlName',
  'attribute',
] as const;
export type FixKind = (typeof FIX_KINDS)[number];

export interface KindedFix extends Fix {
  kind: FixKind;
}

type Rule = (d: Diagnostic, ctx: FixContext) => KindedFix[];

const edit = (from: number, to: number, insert: string): TextEdit => ({ from, to, insert });
const fix = (kind: FixKind, title: string, edits: TextEdit[], preferred = false): KindedFix => ({
  kind,
  title,
  edits,
  ...(preferred ? { preferred } : {}),
});

/** The line that holds the start of the diagnostic. */
function around(d: Diagnostic, text: string): Line {
  return lineAtOffset(text, Math.min(d.from, text.length));
}

/** Where the wrong name sits: inside the diagnostic's range when it is there, else the nearest on its line. */
function locate(d: Diagnostic, ctx: FixContext, name: string): { from: number; to: number } | null {
  if (ctx.text.slice(d.from, d.to) === name) return { from: d.from, to: d.to };
  const line = around(d, ctx.text);
  const at = findWord(ctx.text, name, Math.min(line.from, d.from), Math.max(line.to, d.to), d.from);
  return at < 0 ? null : { from: at, to: at + name.length };
}

function builtinsOf(language: FixContext['language']): Iterable<string> {
  if (language === 'python') return PYTHON_BUILTINS;
  if (language === 'javascript' || language === 'typescript') return JS_GLOBALS;
  if (language === 'lua') return LUA_GLOBALS.split(' ');
  if (language === 'c' || language === 'cpp') return C_FUNCTIONS;
  return [];
}

const NOT_DEFINED = new RegExp(
  `(?:name '(${WORD})' is not defined|'(${WORD})' is not defined|undeclared identifier '(${WORD})'|(${WORD}) is not defined)`,
  'u',
);

function undefinedName(d: Diagnostic): string | null {
  const m = NOT_DEFINED.exec(d.message);
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4] ?? null) : null;
}

/** "Did you mean": names the file declares, then the language's built-ins, within CPython's distance rule. */
const didYouMean: Rule = (d, ctx) => {
  const name = undefinedName(d);
  if (!name) return [];
  // A known library name is missing its import or include, which another fix offers: a near name would mislead.
  if (ctx.language === 'python' && PYTHON_IMPORTS[name]) return [];
  if ((ctx.language === 'c' || ctx.language === 'cpp') && headerFor(name, ctx.language)) return [];
  const where = locate(d, ctx, name);
  if (!where) return [];
  const declared = declaredNames(ctx.text);
  declared.delete(name);
  const near = suggestions(name, [...declared, ...builtinsOf(ctx.language)]);
  return near.map((candidate, i) =>
    fix(
      'didYouMean',
      t('codeStudio.fixes.titles.change', { name: candidate }),
      [edit(where.from, where.to, candidate)],
      i === 0,
    ),
  );
};

/**
 * Where a new import or include line goes: after the last line that matches `prefix` in the opening block of the
 * file, else after the header comments and the module docstring.
 */
function importPosition(text: string, prefix: RegExp): { at: number; before: string } {
  let at = 0;
  let found = false;
  let docstring = '';
  for (let line = lineNumbered(text, 1); line; line = lineNumbered(text, line.number + 1)) {
    const trimmed = line.text.trim();
    const end = Math.min(line.to + 1, text.length);
    if (docstring) {
      if (trimmed.includes(docstring)) {
        docstring = '';
        at = end;
      }
    } else if (prefix.test(trimmed)) {
      found = true;
      at = end;
    } else if (!found && /^(?:"""|''')/.test(trimmed)) {
      if (trimmed.length > 3 && trimmed.slice(3).includes(trimmed.slice(0, 3))) at = end;
      else docstring = trimmed.slice(0, 3);
    } else if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      if (!found) at = end;
    } else break;
    if (line.to >= text.length) break;
  }
  const needsBreak = at > 0 && at >= text.length && !text.endsWith('\n');
  return { at, before: needsBreak ? eolOf(text) : '' };
}

const addImport: Rule = (d, ctx) => {
  if (ctx.language !== 'python') return [];
  const name = undefinedName(d);
  const line = name ? PYTHON_IMPORTS[name] : undefined;
  if (!name || !line) return [];
  const { at, before } = importPosition(ctx.text, /^(?:import|from)\s/);
  return [
    fix(
      'addImport',
      t('codeStudio.fixes.titles.addImport', { line }),
      [edit(at, at, `${before}${line}${eolOf(ctx.text)}`)],
      true,
    ),
  ];
};

const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function unclosedOpener(d: Diagnostic): { open: string; line: number | null } | null {
  const m = /'([([{])' (?:opened on line (\d+) is never closed|was never closed)/.exec(d.message);
  return m ? { open: m[1]!, line: m[2] ? Number(m[2]) : null } : null;
}

/** Closes a bracket at the end of the block that follows its line (the lines indented deeper than the opener's). */
const closeBracket: Rule = (d, ctx) => {
  const found = unclosedOpener(d);
  if (!found) return [];
  const opener = found.line ? lineNumbered(ctx.text, found.line) : around(d, ctx.text);
  if (!opener) return [];
  const base = indentWidth(indentOf(opener.text));
  let last = opener;
  for (let next = lineNumbered(ctx.text, opener.number + 1); next; next = lineNumbered(ctx.text, next.number + 1)) {
    if (!isBlank(next)) {
      if (indentWidth(indentOf(next.text)) <= base && !/^\s*[)\]}]/.test(next.text)) break;
      last = next;
    }
  }
  const closer = CLOSERS[found.open]!;
  const own = found.open === '{' && last !== opener && ctx.language !== 'python';
  const at = codeEnd(last, ctx.language);
  // A string left open on that line takes its quote first, so one edit closes both and the checker is satisfied.
  const spot = ctx.language === 'sql' || ctx.language === 'lua' ? null : quoteSpot(last);
  // `print("a" + "b)`: the bracket sits inside the string, so the quote goes before it and closes the call too.
  if (spot?.kept && found.open === '(') {
    return [
      fix(
        'closeBracket',
        t('codeStudio.fixes.titles.close', { char: closer }),
        [edit(spot.at, spot.at, spot.quote)],
        true,
      ),
    ];
  }
  const insert = (spot?.quote ?? '') + (own ? `${eolOf(ctx.text)}${indentOf(opener.text)}${closer}` : closer);
  return [fix('closeBracket', t('codeStudio.fixes.titles.close', { char: closer }), [edit(at, at, insert)], true)];
};

/** The quote that opens a string left open on this line, and where. */
function openQuote(line: Line): { quote: string; at: number } | null {
  let quote = '';
  let at = -1;
  for (let i = 0; i < line.text.length; i += 1) {
    const ch = line.text[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
    } else if (line.text.startsWith('"""', i) || line.text.startsWith("'''", i)) return null;
    else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      at = i;
    } else if (ch === '#' || (ch === '/' && line.text[i + 1] === '/')) break;
  }
  return quote ? { quote, at } : null;
}

/** Where the closing quote of a string left open on `line` goes, and how many brackets after it stay. */
function quoteSpot(line: Line): { quote: string; at: number; kept: boolean } | null {
  const open = openQuote(line);
  if (!open) return null;
  const rest = line.text.slice(open.at + 1);
  // `print("hi)`: the brackets that close the call come after the closing quote.
  let depth = 0;
  for (const ch of line.text.slice(0, open.at)) depth += '([{'.includes(ch) ? 1 : ')]}'.includes(ch) ? -1 : 0;
  const trailing = /[)\]};,\s]*$/.exec(rest)![0];
  const closers = trailing.replace(/[\s;,]/g, '').length;
  const keep = depth > 0 && closers > 0 && closers <= depth ? trailing.length : /\s*;?$/.exec(rest)![0].length;
  return { quote: open.quote, at: line.from + line.text.length - keep, kept: keep === trailing.length && closers > 0 };
}

const closeQuote: Rule = (d, ctx) => {
  if (d.severity !== 'error' || ctx.language === 'sql' || ctx.language === 'lua') return [];
  const spot = quoteSpot(around(d, ctx.text));
  if (!spot) return [];
  return [
    fix(
      'closeQuote',
      t('codeStudio.fixes.titles.closeQuote', { char: spot.quote }),
      [edit(spot.at, spot.at, spot.quote)],
      true,
    ),
  ];
};

const blockHeader = (line: Line): boolean => /:\s*(?:#.*)?$/.test(line.text);

function previousLine(ctx: FixContext, line: Line, keep: (l: Line) => boolean): Line | null {
  for (let n = line.number - 1; n >= 1; n -= 1) {
    const found = lineNumbered(ctx.text, n);
    if (found && !isBlank(found) && keep(found)) return found;
  }
  return null;
}

/**
 * Sets the indentation of `line` and of the deeper lines under it, keeping their relative depth. The new indent keeps
 * the file's own characters: the target string, then whatever the line had beyond its own first indent.
 */
function reindent(ctx: FixContext, line: Line, indent: string): TextEdit[] {
  const own = indentOf(line.text);
  const before = indentWidth(own);
  const edits: TextEdit[] = [];
  for (let l: Line | null = line; l; l = lineNumbered(ctx.text, l.number + 1)) {
    if (isBlank(l)) continue;
    const mine = indentOf(l.text);
    if (l !== line && indentWidth(mine) <= before) break;
    const extra = mine.startsWith(own) ? mine.slice(own.length) : ' '.repeat(Math.max(0, indentWidth(mine) - before));
    edits.push(edit(l.from, l.from + mine.length, indent + extra));
  }
  return edits;
}

/** One step of indentation in the file's style: a tab when the block header or the file indents with tabs. */
function indentUnit(ctx: FixContext, header: Line): string {
  const own = indentOf(header.text);
  return own.includes('\t') || (!own && /^\t/m.test(ctx.text)) ? '\t' : '    ';
}

const fixIndent: Rule = (d, ctx) => {
  if (ctx.language !== 'python') return [];
  const line = around(d, ctx.text);
  const title = t('codeStudio.fixes.titles.indent');
  const make = (edits: TextEdit[]) => [fix('fixIndent', title, edits, true)];
  if (/\t/.test(indentOf(line.text)) && /tabs|W191|E101/i.test(`${d.message} ${d.code}`)) {
    const indent = indentOf(line.text);
    return make([edit(line.from, line.from + indent.length, ' '.repeat(indentWidth(indent)))]);
  }
  let kind = /expected an indented block/i.test(d.message)
    ? 'block'
    : /unexpected indent/i.test(d.message)
      ? 'unexpected'
      : /unindent does not match|inconsistent use of tabs/i.test(d.message)
        ? 'unindent'
        : '';
  if (!kind && /^Syntax error: .+ is not expected here/.test(d.message)) {
    // The editor's own parser does not name the indentation problem: read it from the lines around.
    const prev = previousLine(ctx, line, () => true);
    if (prev && !isBlank(line)) {
      const mine = indentWidth(indentOf(line.text));
      const theirs = indentWidth(indentOf(prev.text));
      if (blockHeader(prev) && mine <= theirs) kind = 'block';
      else if (!blockHeader(prev) && mine > theirs) kind = 'unexpected';
    }
  }
  if (kind === 'block') {
    const header = previousLine(ctx, line, blockHeader);
    if (!header) return [];
    const unit = indentUnit(ctx, header);
    if (isBlank(line)) {
      return make([edit(header.to, header.to, `${eolOf(ctx.text)}${indentOf(header.text)}${unit}pass`)]);
    }
    return make(reindent(ctx, line, indentOf(header.text) + unit));
  }
  if (kind === 'unexpected') {
    const prev = previousLine(ctx, line, () => true);
    return prev ? make(reindent(ctx, line, indentOf(prev.text))) : [];
  }
  if (kind === 'unindent') {
    const mine = indentWidth(indentOf(line.text));
    let best = '';
    let bestWidth = 0;
    for (let n = line.number - 1; n >= 1; n -= 1) {
      const l = lineNumbered(ctx.text, n);
      if (l && !isBlank(l)) {
        const w = indentWidth(indentOf(l.text));
        if (w < mine && w > bestWidth) {
          best = indentOf(l.text);
          bestWidth = w;
        }
      }
    }
    return make(reindent(ctx, line, best));
  }
  return [];
};

const addColon: Rule = (d, ctx) => {
  if (ctx.language !== 'python' || !/expected ':'/i.test(d.message)) return [];
  const line = lineAtOffset(ctx.text, Math.max(d.from, d.to - 1));
  const at = codeEnd(line, 'python');
  return ctx.text[at - 1] === ':'
    ? []
    : [fix('addColon', t('codeStudio.fixes.titles.addColon'), [edit(at, at, ':')], true)];
};

const SEMICOLON_LANGUAGES = new Set(['c', 'cpp', 'java', 'javascript', 'typescript', 'rust']);

/** How far back the bracket scan reads: a statement that is longer is not one a semicolon fixes. */
const SCAN_BACK = 20_000;

/**
 * The offset sits inside an open call, array, or object: a semicolon there would be a new syntax error. A "(" or "["
 * always counts. A "{" counts only when it opens an object literal, which in JavaScript and TypeScript follows an
 * operator, a comma, a colon, an opening bracket, or "return"; a block's brace takes semicolons.
 */
function insideBrackets(text: string, at: number, language: FixContext['language']): boolean {
  let nest = 0;
  const stop = Math.max(0, at - SCAN_BACK);
  for (let i = at - 1; i >= stop; i -= 1) {
    const ch = text[i]!;
    if (ch === ')' || ch === ']' || ch === '}') nest += 1;
    else if (ch === ';' && nest === 0) return false;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (nest > 0) nest -= 1;
      else if (ch !== '{') return true;
      else {
        if (language !== 'javascript' && language !== 'typescript') return false;
        const lead = text.slice(Math.max(0, i - 12), i).trimEnd();
        return lead === '' ? false : /[=(,:[?+*/&|<>!-]$|\breturn$/.test(lead);
      }
    }
  }
  return false;
}

const addSemicolon: Rule = (d, ctx) => {
  if (!SEMICOLON_LANGUAGES.has(ctx.language)) return [];
  const asked = /expected ';'|missing semicolon/i.test(d.message);
  const unexpected = /^Syntax error: '[^']+' is not expected here/.test(d.message);
  if (!asked && !unexpected) return [];
  let at = d.from;
  while (at > 0 && /\s/.test(ctx.text[at - 1]!)) at -= 1;
  const before = ctx.text[at - 1];
  if (!before || ';{}(,[=+-*/&|<>:?!.'.includes(before)) return [];
  if (unexpected && !/[\p{L}\p{N}_$)\]"'`]/u.test(before)) return [];
  if (insideBrackets(ctx.text, at, ctx.language)) return [];
  const line = lineAtOffset(ctx.text, at - 1);
  if (ctx.text.slice(line.from, at).includes('//')) {
    // A trailing comment ends the line: the semicolon goes before it.
    const end = codeEnd(line, ctx.language);
    if (end <= line.from || ';{}(,[=+-*/&|<>:?!.'.includes(ctx.text[end - 1]!)) return [];
    return [fix('addSemicolon', t('codeStudio.fixes.titles.addSemicolon'), [edit(end, end, ';')], true)];
  }
  return [fix('addSemicolon', t('codeStudio.fixes.titles.addSemicolon'), [edit(at, at, ';')], true)];
};

const SINGLE_EQUALS = /(?<![=!<>:+\-*/%&|^])=(?![=>])/;

const equalsToCompare: Rule = (d, ctx) => {
  if (!/Maybe you meant '=='|assigns a value|assignment as a condition|no-cond-assign/.test(`${d.message} ${d.code}`)) {
    return [];
  }
  const line = around(d, ctx.text);
  for (const [from, to] of [
    [d.from, d.to],
    [line.from, line.to],
  ] as const) {
    const m = SINGLE_EQUALS.exec(ctx.text.slice(from, to));
    if (m) {
      const at = from + m.index;
      return [fix('equalsToCompare', t('codeStudio.fixes.titles.compare'), [edit(at, at + 1, '==')], true)];
    }
  }
  return [];
};

const addSelf: Rule = (d, ctx) => {
  if (ctx.language !== 'python' || undefinedName(d) !== 'self') return [];
  const line = around(d, ctx.text);
  const width = indentWidth(indentOf(line.text));
  const def = previousLine(
    ctx,
    line,
    (l) => indentWidth(indentOf(l.text)) < width && /^\s*(?:async\s+)?def\s/.test(l.text),
  );
  if (!def) return [];
  const defWidth = indentWidth(indentOf(def.text));
  const inClass = previousLine(ctx, def, (l) => indentWidth(indentOf(l.text)) < defWidth && /^\s*class\s/.test(l.text));
  const open = def.text.indexOf('(');
  if (!inClass || open < 0) return [];
  const params = def.text.slice(open + 1, def.text.indexOf(')', open));
  if (/^\s*self\b/.test(params)) return [];
  const at = def.from + open + 1;
  return [
    fix('addSelf', t('codeStudio.fixes.titles.addSelf'), [edit(at, at, params.trim() ? 'self, ' : 'self')], true),
  ];
};

const addInclude: Rule = (d, ctx) => {
  if (ctx.language !== 'c' && ctx.language !== 'cpp') return [];
  const name = undefinedName(d) ?? /(?:no member named|unknown type name|no type named) '(\w+)'/.exec(d.message)?.[1];
  if (!name) return [];
  const qualified = ctx.text.slice(Math.max(0, d.from - 5), d.from) === 'std::' ? `std::${name}` : name;
  const header = headerFor(qualified, ctx.language) ?? headerFor(name, ctx.language);
  if (!header) return [];
  const line = `#include <${header}>`;
  if (ctx.text.includes(line)) return [];
  const { at, before } = importPosition(ctx.text, /^#\s*include\b/);
  const hasIncludes = /^#\s*include\b/m.test(ctx.text);
  const blank = hasIncludes || ctx.text.slice(at, at + 1) === '\n' ? '' : '\n';
  return [
    fix(
      'addInclude',
      t('codeStudio.fixes.titles.include', { line }),
      [edit(at, at, `${before}${line}${eolOf(ctx.text)}${blank && eolOf(ctx.text)}`)],
      true,
    ),
  ];
};

/** Tables and columns that the CREATE TABLE statements of the file and the project declare. */
let schemaKey: { text: string; files: FixContext['files'] } | null = null;
let schemaCache = new Map<string, string[]>();

/** The most one table's column list is read: an unclosed "(" cannot make the scan run to the end of a huge text. */
const MAX_TABLE_SCAN = 20_000;

export function sqlSchema(ctx: FixContext): Map<string, string[]> {
  if (schemaKey && schemaKey.text === ctx.text && schemaKey.files === ctx.files) return schemaCache;
  const found = readSchema(ctx);
  schemaKey = { text: ctx.text, files: ctx.files };
  schemaCache = found;
  return found;
}

function readSchema(ctx: FixContext): Map<string, string[]> {
  const schema = new Map<string, string[]>();
  const sources = [ctx.text, ...(ctx.files ?? []).map((f) => f.text)];
  const create = /create\s+(?:temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?["`[]?(\w+)["`\]]?\s*\(/gi;
  for (const source of sources) {
    const starts = [...source.matchAll(create)];
    for (const [k, m] of starts.entries()) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      // The list ends at its closing ")", at the next CREATE TABLE, at a ";" outside brackets, or at the scan cap.
      const limit = Math.min(source.length, start + MAX_TABLE_SCAN, starts[k + 1]?.index ?? source.length);
      for (; i < limit && depth > 0; i += 1) {
        const ch = source[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        else if (ch === ';' && depth === 1) {
          i += 1;
          break;
        }
      }
      if (depth > 0 && i >= limit) i = Math.max(start + 1, i);
      const columns: string[] = [];
      let level = 0;
      let part = '';
      for (const ch of `${source.slice(start, i - 1)},`) {
        if (ch === '(') level += 1;
        if (ch === ')') level -= 1;
        if (ch === ',' && level === 0) {
          const first = /^\s*["`[]?(\w+)/.exec(part)?.[1];
          if (first && !/^(?:primary|foreign|unique|check|constraint)$/i.test(first)) columns.push(first);
          part = '';
        } else part += ch;
      }
      schema.set(m[1]!, columns);
    }
  }
  return schema;
}

const sqlName: Rule = (d, ctx) => {
  const m = /no such (column|table): ([\w.]+)/i.exec(d.message);
  if (!m || ctx.language !== 'sql') return [];
  const schema = sqlSchema(ctx);
  const kind = m[1]!.toLowerCase();
  const parts = m[2]!.split('.');
  const name = parts[parts.length - 1]!;
  const qualifier = parts.length > 1 ? parts[0] : undefined;
  const pool =
    kind === 'table'
      ? [...schema.keys()]
      : qualifier && schema.has(qualifier)
        ? schema.get(qualifier)!
        : [...schema.values()].flat();
  const line = around(d, ctx.text);
  const at = findWord(ctx.text, name, Math.min(d.from, line.from), Math.max(d.to, line.to), d.from);
  if (at < 0) return [];
  return suggestions(name, pool).map((candidate, i) =>
    fix(
      'sqlName',
      t('codeStudio.fixes.titles.change', { name: candidate }),
      [edit(at, at + name.length, candidate)],
      i === 0,
    ),
  );
};

let membersText: string | null = null;
let membersCache: string[] = [];

/** The names used after a dot anywhere in the file, found once per text. */
function usedMembers(text: string): string[] {
  if (membersText !== text) {
    membersCache = [...new Set([...text.matchAll(/\.([\p{L}_$][\p{L}\p{N}_$]*)/gu)].map((m) => m[1]!))];
    membersText = text;
  }
  return membersCache;
}

/** `AttributeError: 'Foo' object has no attribute 'lenght'`: the names used after a dot in the file, and the type's table. */
const attribute: Rule = (d, ctx) => {
  const m = /has no attribute '(\w+)'/.exec(d.message);
  if (!m) return [];
  const wrong = m[1]!;
  const line = around(d, ctx.text);
  const dot = new RegExp(`(${WORD})\\.${wrong}(?![\\p{L}\\p{N}_$])`, 'u').exec(ctx.text.slice(line.from, line.to));
  if (!dot) return [];
  const at = line.from + dot.index + dot[0].length - wrong.length;
  const pool = new Set<string>();
  for (const member of membersOf(ctx.language, ctx.text, dot[1]!, at)) pool.add(member.name);
  for (const used of usedMembers(ctx.text)) pool.add(used);
  pool.delete(wrong);
  return suggestions(wrong, pool).map((candidate, i) =>
    fix(
      'attribute',
      t('codeStudio.fixes.titles.change', { name: candidate }),
      [edit(at, at + wrong.length, candidate)],
      i === 0,
    ),
  );
};

export const RULES: readonly Rule[] = [
  didYouMean,
  addImport,
  addSelf,
  addInclude,
  sqlName,
  attribute,
  closeBracket,
  closeQuote,
  fixIndent,
  addColon,
  addSemicolon,
  equalsToCompare,
];
