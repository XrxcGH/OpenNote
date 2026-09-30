// Ease of learning: text should be readable by a newcomer, and acronyms defined on first use.

import type { Finding, Rule, SourceFile, Threshold } from '../types.ts';
import { grade, numberSetting, stringList, threshold } from '../config.ts';
import { gradeLevel, sentences, stripQuotes, wordCount } from '../text.ts';
import { isProseFile, loadData, reporter } from './helpers.ts';

const DEFAULT_GRADE: Threshold = { warn: 12, error: 16 };
const ACRONYM = /\b[A-Z][A-Z0-9]*[A-Z][A-Z0-9]*s?\b/g;

let baseAllowList: string[] | undefined;

export const readability: Rule = {
  id: 'readability',
  description: 'Reading grade level per section and acronyms defined on first use.',
  appliesTo: isProseFile,
  check(file, ctx) {
    const gradeLimit = threshold(ctx.settings, 'grade', DEFAULT_GRADE);
    const minWords = numberSetting(ctx.settings, 'minSectionWords', 80);
    baseAllowList ??= loadData<{ allow: string[] }>('acronyms.json').allow;
    const allowed = new Set([...baseAllowList, ...stringList(ctx.settings, 'allowAcronyms')]);
    return [...gradeFindings(file, gradeLimit, minWords), ...acronymFindings(file, allowed)];
  },
};

function gradeFindings(file: SourceFile, limit: Threshold, minWords: number): Finding[] {
  const report = reporter('readability', file);
  const findings: Finding[] = [];
  let sectionLine = 1;
  let collected: string[] = [];
  const close = () => {
    const wordTotal = collected.reduce((sum, s) => sum + wordCount(s), 0);
    const level = gradeLevel(collected);
    const severity = wordTotal >= minWords ? grade(level, limit) : undefined;
    if (severity)
      findings.push(
        report(
          sectionLine,
          `Reading grade ${level.toFixed(1)} (target ${limit.warn} or lower). Use shorter sentences and simpler words.`,
          severity,
        ),
      );
  };
  for (const block of file.blocks()) {
    if (block.context === 'heading') {
      close();
      sectionLine = block.line;
      collected = [];
    } else if (block.context !== 'table') {
      collected.push(...sentences(block.text));
    }
  }
  close();
  return findings;
}

function acronymFindings(file: SourceFile, allowed: Set<string>): Finding[] {
  const report = reporter('readability', file);
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const prose of file.prose()) {
    if (prose.context === 'heading' || prose.context === 'table') continue;
    const text = stripQuotes(prose.text);
    for (const acronym of text.match(ACRONYM) ?? []) {
      const base = acronym.replace(/s$/, '');
      if (allowed.has(acronym) || allowed.has(base) || seen.has(base)) continue;
      seen.add(base);
      if (!isDefined(text, base))
        findings.push(report(prose.line, `Define "${base}" on first use, e.g. "full name (${base})".`, 'warning'));
    }
  }
  return findings;
}

function isDefined(text: string, acronym: string): boolean {
  return (
    text.includes(`(${acronym})`) || text.includes(`(${acronym}s)`) || new RegExp(`\\b${acronym}s? \\(`).test(text)
  );
}
