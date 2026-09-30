// American English spelling. Quoted text is skipped so sources can be quoted exactly.

import type { Finding, Rule } from '../types.ts';
import { stringList } from '../config.ts';
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

export const spelling: Rule = {
  id: 'spelling',
  description: 'Flags British and other non-American spellings.',
  appliesTo: (file) => file.kind !== 'data' && file.kind !== 'other',
  check(file, ctx) {
    const report = reporter('spelling', file);
    const dict = americanDictionary();
    const allowed = new Set(stringList(ctx.settings, 'allow').map((w) => w.toLowerCase()));
    const findings: Finding[] = [];
    for (const prose of file.prose()) {
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
