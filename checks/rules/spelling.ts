// American English spelling. Quoted text is skipped so sources can be quoted exactly. It reads docs and code comments,
// and the text in the string literals of source files that show words to people (`strings` in checks.config.json:
// the interface strings and the messages Rust shows). A proper name or a quoted source goes in `allow`, or in
// double quotes, or gets a `checks-disable-next-line spelling: <reason>` comment.

import type { Finding, Rule, SourceFile } from '../types.ts';
import { stringList } from '../config.ts';
import { matchesAny } from '../glob.ts';
import { matchCase, stripQuotes } from '../text.ts';
import { loadData, reporter } from './helpers.ts';

interface SpellingData {
  suffixSets: Record<string, [string, string][]>;
  stems: { set: string; pairs: Record<string, string> }[];
  words: Record<string, string>;
}

let dictionary: Map<string, string> | undefined;

/** Maps every known non-American word form to its American spelling. */
export function americanDictionary(): Map<string, string> {
  if (dictionary) return dictionary;
  const data = loadData<SpellingData>('american-spelling.json');
  const map = new Map<string, string>();
  for (const group of data.stems) {
    const suffixes = data.suffixSets[group.set] ?? [];
    for (const [ukStem, usStem] of Object.entries(group.pairs)) {
      suffixes.forEach(([ukSuffix, usSuffix]) => map.set(ukStem + ukSuffix, usStem + usSuffix));
    }
  }
  Object.entries(data.words).forEach(([uk, us]) => map.set(uk, us));
  dictionary = map;
  return map;
}

// The interface strings in app/src/strings/en are read by the ui-voice rule, which runs this rule on each value.
const DEFAULT_STRING_FILES = ['app/src/**/*.tsx', 'app/src-tauri/src/**/*.rs', 'crates/*/src/**/*.rs'];
const SKIPPED_FILE = /(\.test\.|\/tests?\/|\/fixtures?\/|\/bindings\/|\/golden\/)/;
const SKIPPED_LINE = /^\s*(\/\/|\/\*|\*|import\b|export\s+\*|use\s)|\bfrom\s+['"]/;
const TS_STRING = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const RUST_STRING = /"((?:[^"\\]|\\.)*)"/g;

/**
 * The text inside the string literals of a source file that shows words to people, one entry per literal, shaped
 * like prose so the same word check reads it. Quotes around the literal are not part of the text.
 */
export function stringProse(file: SourceFile, globs: string[]): { line: number; text: string }[] {
  if (file.kind !== 'code' || SKIPPED_FILE.test(`/${file.path}`)) return [];
  if (!matchesAny(file.path, globs.length ? globs : DEFAULT_STRING_FILES)) return [];
  const pattern = file.ext === 'rs' ? RUST_STRING : TS_STRING;
  const out: { line: number; text: string }[] = [];
  file.lines.forEach((raw, i) => {
    if (SKIPPED_LINE.test(raw)) return;
    for (const match of raw.matchAll(pattern)) {
      const text = match[1] ?? match[2] ?? match[3] ?? '';
      // Only a literal that holds words: more than one letter in a row, and a space or a capital to say it is text.
      if (/[A-Za-z]{3}/.test(text) && /\s/.test(text)) out.push({ line: i + 1, text: text.replace(/\\(.)/g, '$1') });
    }
  });
  return out;
}

export const spelling: Rule = {
  id: 'spelling',
  description: 'Flags British and other non-American spellings.',
  appliesTo: (file) => file.kind !== 'data' && file.kind !== 'other',
  check(file, ctx) {
    const report = reporter('spelling', file);
    const dict = americanDictionary();
    const allowed = new Set(stringList(ctx.settings, 'allow').map((w) => w.toLowerCase()));
    const findings: Finding[] = [];
    for (const prose of [...file.prose(), ...stringProse(file, stringList(ctx.settings, 'strings'))]) {
      for (const word of stripQuotes(prose.text).match(/[A-Za-z]+/g) ?? []) {
        const american = dict.get(word.toLowerCase());
        if (!american || allowed.has(word.toLowerCase())) continue;
        const fixed = matchCase(word, american);
        const fix = { line: prose.line, from: word, to: fixed };
        findings.push(report(prose.line, `"${word}" is not American spelling. Use "${fixed}".`, 'error', fix));
      }
    }
    return findings;
  },
};
