// Plain-language explanations of errors (DESIGN 7.2, lane code:L11). `explain` reads the message a runtime or compiler
// printed, finds its entry in the catalog of that language, and returns what happened, the likely cause, and the next
// thing to try, with the failing line quoted. Nothing matches? The raw message comes back with a generic hint.

import { explainEntries } from '../../../strings/en/codeStudio/explainEntries';
import { formatMessage, t } from '../../../strings/t';
import { CLANG_ENTRIES } from './clang';
import { JAVASCRIPT_ENTRIES } from './javascript';
import { LUA_ENTRIES } from './lua';
import { PYTHON_ENTRIES } from './python';
import { SQLITE_ENTRIES } from './sqlite';
import type { CatalogEntry, EntryId, ExplainLanguage } from './types';

export type { CatalogEntry, EntryId, ExplainLanguage } from './types';

export const CATALOG: Readonly<Record<ExplainLanguage, readonly CatalogEntry[]>> = {
  python: PYTHON_ENTRIES,
  javascript: JAVASCRIPT_ENTRIES,
  typescript: JAVASCRIPT_ENTRIES,
  c: CLANG_ENTRIES,
  cpp: CLANG_ENTRIES,
  sql: SQLITE_ENTRIES,
  lua: LUA_ENTRIES,
};

/** What the trace knows when the error happened, such as the index and the length behind an IndexError. */
export interface RuntimeHints {
  index?: number;
  length?: number;
}

export interface ExplainInput {
  language: ExplainLanguage;
  /** The runtime's message: the last line of a Python traceback, a clang line, a SQLite error, and so on. */
  message: string;
  /** 1-based line of the failure, when known. */
  line?: number;
  /** The text of that line, quoted back. */
  lineText?: string;
  hints?: RuntimeHints;
}

export interface Explanation {
  /** The catalog entry, or null for an error the catalog does not know. */
  id: EntryId | null;
  what: string;
  cause: string;
  next: string;
  /** "Line 3: total = total + x", when the line is known. */
  quote?: string;
  /** Extra help from the trace, such as the valid indexes of a list. */
  hint?: string;
  /** The message as the runtime printed it, cleaned of file prefixes. */
  raw: string;
}

/** A message is read only up to here: a runtime's message is short, and a huge one must not stall the matching. */
export const MAX_MESSAGE = 2000;

/** The message without the file, line, and flag decoration each runtime wraps around it. */
export function cleanMessage(language: ExplainLanguage, message: string): string {
  let text = message.slice(0, MAX_MESSAGE).replace(/\r/g, '').trim();
  if (language === 'python') {
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    text = (lines[lines.length - 1] ?? '').trim();
    if (!/^[A-Za-z_.]+(?:Error|Exception|Warning|Exit|Interrupt|Iteration)\b/.test(text) && lines.length > 1) {
      const found = [...lines]
        .reverse()
        .find((l) => /^[A-Za-z_.]+(?:Error|Exception|Exit|Interrupt|Iteration)\b/.test(l));
      if (found) text = found.trim();
    }
    text = text.replace(/^(?:builtins|__main__)\./, '');
  } else if (language === 'c' || language === 'cpp') {
    text = text
      .split('\n')[0]!
      .replace(/^[^:\n]*:\d+(?::\d+)?:\s*/, '')
      .replace(/^(?:fatal error|error|warning):\s*/, '')
      .replace(/\s*\[-W[\w-]+(?:,-W[\w-]+)*\]\s*$/, '');
  } else if (language === 'lua') {
    text = text.split('\n')[0]!.replace(/^(?:lua:\s*)?(?:\[string [^\n]*?\]|[^\s:]+):\d+:\s*/, '');
  } else if (language === 'sql') {
    text = text.split('\n')[0]!.replace(/^(?:Error: |SQLITE_\w+: |sqlite3\.\w+Error: |OperationalError: )/, '');
  } else {
    text = text.split('\n')[0]!;
  }
  return text.trim();
}

type Values = Record<string, string | number>;

/** "A int" becomes "An int": the sentences start with "A" before a name that comes from the message. */
export function fixArticles(text: string): string {
  return text.replace(/\bA (?=(?:[aeiAEI]|o(?!ne\b)|u(?!ni|se|ti|rl))\w*)/g, 'An ');
}

function words(key: string, values: Values): string {
  const [id, part] = key.split('.') as [string, string];
  const entry = (explainEntries as Record<string, Record<string, string> | undefined>)[id];
  return fixArticles(formatMessage(entry?.[part] ?? '', values));
}

/** Named groups of the match, empty ones dropped, plus `message` for entries that quote it. */
function valuesOf(match: RegExpExecArray, raw: string): Values {
  const values: Values = { message: raw };
  // A pattern with two spellings of one message names the second spelling's groups `name2`, `what2`: they fold back.
  for (const [name, value] of Object.entries(match.groups ?? {}))
    if (value !== undefined) values[name.replace(/2$/, '')] = value;
  return values;
}

/**
 * Valid indexes of a sequence, in words, from the index that failed and the length when the trace has them. CPython's
 * IndexError text carries neither, so the caller supplies the hints: the debug frame (lane code:L08) or a re-evaluation
 * of the failing subscript. Without hints the explanation simply has no index sentence.
 */
export function indexHint(hints: RuntimeHints | undefined): string | undefined {
  if (!hints || hints.index === undefined || hints.length === undefined) return undefined;
  const { index, length } = hints;
  if (length === 0) return t('codeStudio.explain.hints.emptySequence', { index });
  const range = t('codeStudio.explain.hints.validIndexes', { length, last: length - 1 });
  const detail =
    index < 0
      ? t('codeStudio.explain.hints.negative', { index, first: -length })
      : index === length
        ? t('codeStudio.explain.hints.oneTooFar', { index })
        : t('codeStudio.explain.hints.asked', { index });
  return `${range} ${detail} ${t('codeStudio.explain.hints.loop')}`;
}

/** Explains one error. */
export function explain(input: ExplainInput): Explanation {
  const raw = cleanMessage(input.language, input.message);
  const quote =
    input.lineText !== undefined && input.line !== undefined
      ? t('codeStudio.explain.quote', { line: input.line, text: input.lineText.trim() })
      : undefined;
  for (const candidate of CATALOG[input.language] ?? []) {
    const match = candidate.pattern.exec(raw);
    if (!match) continue;
    const values = valuesOf(match, raw);
    const hint =
      candidate.id === 'pyIndexOutOfRange' || candidate.id === 'pyPopEmpty' ? indexHint(input.hints) : undefined;
    return {
      id: candidate.id,
      what: words(`${candidate.id}.what`, values),
      cause: words(`${candidate.id}.cause`, values),
      next: words(`${candidate.id}.next`, values),
      ...(quote ? { quote } : {}),
      ...(hint ? { hint } : {}),
      raw,
    };
  }
  return {
    id: null,
    what: t('codeStudio.explain.unknown.what'),
    cause: t('codeStudio.explain.unknown.cause'),
    next: t('codeStudio.explain.unknown.next'),
    ...(quote ? { quote } : {}),
    raw,
  };
}
