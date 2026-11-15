// The pattern predictor (DESIGN 10.2): one line of ghost text without a model, shown only when confident.
// Rules, in order: the language's idioms, closing a `def` or `class` line, repeated lines with a numeric step,
// and an earlier line with the same start. Block bodies after a new line are left to the model.

import { family, own } from './tables';
import { lineAt, tokenize } from './tokens';
import type { Token } from './tokens';

/** Automatic ghost text needs this confidence. */
export const AUTO_THRESHOLD = 0.6;
/** An explicit request (Ctrl+Tab with nothing showing, or Alt+\) needs only this. */
export const EXPLICIT_THRESHOLD = 0.35;

export type PatternRule = 'idiom' | 'signature' | 'step' | 'sameStart';

export interface Prediction {
  /** The text to insert at the caret: one line, never empty. */
  text: string;
  confidence: number;
  rule: PatternRule;
}

interface Line {
  text: string;
  before: string;
  pos: number;
}

type Idiom = (line: Line, language: string) => { text: string; confidence: number } | null;

const sure = (text: string | null, confidence = 0.9) => (text ? { text, confidence } : null);

/** `import numpy as` gives ` np`; with the space already typed, `np`. */
function alias(module: string, short: string): Idiom {
  const pattern = new RegExp(`^\\s*import ${module.replace(/\./g, '\\.')} as( ?)$`);
  return ({ before }) => {
    const match = pattern.exec(before);
    return match ? sure(match[1] ? short : ` ${short}`) : null;
  };
}

const ends =
  (pattern: RegExp, text: string): Idiom =>
  ({ before }) =>
    sure(pattern.test(before) ? text : null);

/** `for (int i = 0; i < ` gives `n; i++) {`, with the bound from a nearby `n`, `.size()`, or `.length`. */
const countedFor: Idiom = ({ before, text, pos }, language) => {
  const match = /^\s*for\s*\(\s*(?:int|let|var|size_t|auto|long)\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*$/.exec(before);
  if (!match) return null;
  const counter = match[1]!;
  const nearby = text.slice(Math.max(0, pos - before.length - 2000), pos - before.length);
  const sized = language === 'javascript' ? /(\w+)\.length\b/g : /(\w+)\.size\(\)/g;
  const lastSized = [...nearby.matchAll(sized)].pop()?.[0];
  const bound = /\bn\b/.test(nearby) ? 'n' : (lastSized ?? 'n');
  const confidence = bound === 'n' && !/\bn\b/.test(nearby) ? 0.5 : 0.85;
  return { text: `${bound}; ${counter}++) {`, confidence };
};

/** `SELECT * FROM ` gives the table named last in the PREDICT_WINDOW characters above. Not in a comment. */
const lastTable: Idiom = ({ before, text, pos }) => {
  if (!/\bFROM\s$/i.test(before) || before.includes('--') || before.split("'").length % 2 === 0) return null;
  const start = pos - before.length;
  const earlier = text.slice(Math.max(0, start - PREDICT_WINDOW), start);
  const tables = [...earlier.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([A-Za-z_]\w*)/gi)];
  return sure(tables.pop()?.[1] ?? null, 0.7);
};

// Each idiom starts at the line start, so the same words inside a string or after a comment marker never match.
const IDIOMS: Readonly<Record<string, readonly Idiom[]>> = {
  python: [
    ends(/^\s*if __name__ == "$/, '__main__":'),
    ends(/^\s*if __name__ == '$/, "__main__':"),
    alias('numpy', 'np'),
    alias('pandas', 'pd'),
    alias('matplotlib.pyplot', 'plt'),
  ],
  c: [ends(/^\s*#\s*include\s*<$/, 'stdio.h>'), ends(/^\s*int main\($/, 'void) {'), countedFor],
  cpp: [ends(/^\s*#\s*include\s*<$/, 'iostream>'), ends(/^\s*int main\($/, ') {'), countedFor],
  java: [ends(/^\s*public static void main\($/, 'String[] args) {'), countedFor],
  javascript: [countedFor],
  sql: [lastTable],
};

// Return annotations that are whole words: `-> None` gets its `:` at once.
const ANNOTATIONS = new Set(['None', 'int', 'str', 'float', 'bool', 'bytes', 'list', 'dict', 'tuple', 'set', 'object']);

/**
 * A Python `def` or `class` line whose parameters are closed gets its `:`. One pass tracks bracket depth and strings,
 * so a nested `(`, a `)` inside a string, or a comment never counts as the close. After the parameters only a return
 * annotation may follow. An annotation that ends in a word the user may still be typing (`-> tup`) shows only on
 * request.
 */
function signature(line: Line, language: string): { text: string; confidence: number } | null {
  if (family(language) !== 'python') return null;
  const { before } = line;
  const isClass = /^\s*class\s+\w+\s*\(/.test(before);
  if (!isClass && !/^\s*(?:async\s+)?def\s+\w+\s*\(/.test(before)) return null;
  let depth = 0;
  let quote = '';
  let close = -1;
  for (let i = 0; i < before.length; i++) {
    const char = before[i]!;
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '#') return null;
    else if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) {
      depth--;
      if (depth < 0) return null;
      if (depth === 0 && close < 0) close = i;
    } else if (char === ':' && depth === 0 && close >= 0) return null;
  }
  if (quote || depth !== 0 || close < 0) return null;
  const rest = before.slice(close + 1).trim();
  if (!rest) return { text: ':', confidence: 0.9 };
  if (isClass || !rest.startsWith('->') || !rest.slice(2).trim()) return null;
  const word = /\w+$/.exec(rest)?.[0];
  return { text: ':', confidence: !word || ANNOTATIONS.has(word) ? 0.9 : 0.5 };
}

const indentOf = (line: string): string => /^\s*/.exec(line)?.[0] ?? '';

/** The next line of a run whose lines differ only in integers with a constant step, or null. */
function extrapolate(older: Token[], newer: Token[]): { tokens: string[]; steps: number[] } | null {
  if (older.length !== newer.length) return null;
  const tokens: string[] = [];
  const steps: number[] = [];
  for (let i = 0; i < newer.length; i++) {
    const a = older[i]!;
    const b = newer[i]!;
    if (a.text === b.text) {
      tokens.push(b.text);
    } else if (a.kind === 'number' && b.kind === 'number' && /^\d{1,15}$/.test(a.text) && /^\d{1,15}$/.test(b.text)) {
      // Integers of at most 15 digits stay exact. A step below zero would change the line's shape, and a padded
      // number such as `02` keeps its width.
      // `0x08` reads as `0`, `x`, `08`. Its digits are not decimal, so a base prefix stops the rule.
      if (/^[xXbBoO]$/.test(newer[i - 1]?.text ?? '') && newer[i - 2]?.text === '0') return null;
      const step = Number(b.text) - Number(a.text);
      const value = Number(b.text) + step;
      if (value < 0 || String(value).length > 15) return null;
      // After a minus sign, zero would read `-0`.
      if (value === 0 && newer[i - 1]?.text === '-') return null;
      steps.push(step);
      tokens.push(b.text.startsWith('0') ? String(value).padStart(b.text.length, '0') : String(value));
    } else if (a.kind === 'space' && b.kind === 'space') {
      tokens.push(b.text);
    } else {
      return null;
    }
  }
  return steps.length ? { tokens, steps } : null;
}

function step(lines: readonly string[], index: number, before: string): { text: string; confidence: number } | null {
  const indent = indentOf(before);
  const above: string[] = [];
  for (let i = index - 1; i >= 0 && above.length < 3; i--) {
    const line = lines[i]!;
    // A long line (a data dump or minified code) is never tokenized: it ends the run.
    if (line.length > MAX_PREDICT_LINE || !line.trim()) break;
    if (indentOf(line) !== indent) break;
    above.push(line.trim());
  }
  const [newer, older, oldest] = above;
  if (!newer || !older) return null;
  const next = extrapolate(tokenize(older), tokenize(newer));
  if (!next) return null;
  const predicted = indent + next.tokens.join('');
  if (!predicted.startsWith(before) || predicted.length === before.length) return null;
  let confidence = 0.75;
  if (oldest) {
    const earlier = extrapolate(tokenize(oldest), tokenize(older));
    if (earlier && earlier.steps.join() === next.steps.join()) confidence = 0.9;
  }
  if (!before.trim()) confidence -= 0.3;
  return { text: predicted.slice(before.length), confidence };
}

/** Complete tokens typed on the line: a word or number still being typed does not count. */
function completeTokens(prefix: string): number {
  const tokens = tokenize(prefix).filter((token) => token.kind !== 'space');
  const last = tokens[tokens.length - 1];
  const typing = last && (last.kind === 'word' || last.kind === 'number') && prefix.endsWith(last.text);
  return tokens.length - (typing ? 1 : 0);
}

function sameStart(
  lines: readonly string[],
  index: number,
  before: string,
): { text: string; confidence: number } | null {
  const prefix = before.trimStart();
  const complete = completeTokens(prefix);
  if (complete < 1) return null;
  const order: number[] = [];
  for (let distance = 1; distance < lines.length; distance++) {
    if (index - distance >= 0) order.push(index - distance);
    if (index + distance < lines.length) order.push(index + distance);
  }
  let found: string | null = null;
  let other = false;
  for (const i of order) {
    const line = lines[i]!.trim();
    if (line.length <= prefix.length || !line.startsWith(prefix)) continue;
    const rest = line.slice(prefix.length);
    if (found === null) found = rest;
    else if (rest !== found) {
      other = true;
      break;
    }
  }
  if (found === null) return null;
  return { text: found, confidence: Math.min(0.85, 0.35 + 0.12 * complete) - (other ? 0.15 : 0) };
}

// Text after the caret that ghost text may sit before: closing brackets and quotes the editor added.
const CLOSERS = /^[)\]}>"'`]*\s*$/;
const QUOTES = '"\'`';

/**
 * Cuts a prediction before the closer that already follows the caret, so accepting never doubles it. Brackets and
 * strings the prediction opens itself are skipped, so `foo(total), sep="")` before `)` keeps `foo(total), sep=""`.
 * Inside a string (the closer is a quote) the cut is at the first matching quote.
 */
function fit(text: string, after: string): string {
  const closer = after.trim()[0];
  if (!closer) return text;
  if (QUOTES.includes(closer)) {
    const at = text.indexOf(closer);
    return at < 0 ? text : text.slice(0, at);
  }
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = '';
    } else if (QUOTES.includes(char)) quote = char;
    else if ('([{'.includes(char)) depth++;
    else if (depth > 0 && ')]}'.includes(char)) depth--;
    else if (char === closer || ')]}'.includes(char)) return text.slice(0, i);
  }
  return text;
}

/** The predictor skips a caret line longer than this, and reads at most PREDICT_WINDOW characters around it. */
export const MAX_PREDICT_LINE = 500;
const PREDICT_WINDOW = 100_000;

/** The ghost text for the caret, or null when no rule is confident enough. */
export function predict(language: string, fullText: string, fullPos: number, explicit: boolean): Prediction | null {
  const { before, after } = lineAt(fullText, fullPos);
  if (before.length + after.length > MAX_PREDICT_LINE || !CLOSERS.test(after)) return null;
  // A window of whole lines around the caret bounds the work in a large file. A very long line at an edge is cut, so
  // the window never reaches past twice PREDICT_WINDOW on either side.
  // Each edge searches only its own band, so the search never crosses a long line.
  const low = Math.max(0, fullPos - 2 * PREDICT_WINDOW);
  const from =
    fullPos <= PREDICT_WINDOW ? 0 : low + fullText.slice(low, fullPos - PREDICT_WINDOW).lastIndexOf('\n') + 1;
  const high = Math.min(fullText.length, fullPos + 2 * PREDICT_WINDOW);
  const newline = fullText.slice(0, high).indexOf('\n', fullPos + PREDICT_WINDOW);
  const text = fullText.slice(from, newline < 0 ? high : newline);
  const pos = fullPos - from;
  const threshold = explicit ? EXPLICIT_THRESHOLD : AUTO_THRESHOLD;
  const line: Line = { text, before, pos };
  const lang = family(language);
  const lines = text.split('\n');
  const index = text.slice(0, pos).split('\n').length - 1;
  const rules: Array<[PatternRule, () => { text: string; confidence: number } | null]> = [
    ...(own(IDIOMS, lang) ?? []).map((idiom): [PatternRule, () => { text: string; confidence: number } | null] => [
      'idiom',
      () => idiom(line, lang),
    ]),
    ['signature', () => signature(line, lang)],
    ['step', () => step(lines, index, before)],
    ['sameStart', () => sameStart(lines, index, before)],
  ];
  for (const [rule, run] of rules) {
    const found = run();
    if (!found || found.confidence < threshold) continue;
    const ghost = fit(found.text.split('\n')[0] ?? '', after);
    if (ghost) return { text: ghost, confidence: found.confidence, rule };
  }
  return null;
}
