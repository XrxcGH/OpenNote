// Redundant text: wordy phrases, repeated sentences and paragraphs, and text copied between documents.

import type { Finding, Rule, SourceFile, RuleContext } from '../types.ts';
import { createSourceFile } from '../source.ts';
import { matchCase, phrasePattern, sentences, stripQuotes, wordCount } from '../text.ts';
import { loadData, normalize, reporter } from './helpers.ts';

const MIN_SENTENCE_WORDS = 10;
const MIN_PARAGRAPH_WORDS = 20;
const MIN_CROSS_FILE_WORDS = 25;

let phrases: { phrase: string; replacement: string; pattern: RegExp }[] | undefined;

function phraseList() {
  phrases ??= Object.entries(loadData<{ phrases: Record<string, string> }>('redundant-phrases.json').phrases).map(
    ([phrase, replacement]) => ({ phrase, replacement, pattern: phrasePattern(phrase) }),
  );
  return phrases;
}

export const redundancy: Rule = {
  id: 'redundancy',
  description: 'Wordy phrases, repeated sentences or paragraphs, and paragraphs copied from other documents.',
  appliesTo: (file) => file.kind !== 'data' && file.kind !== 'other',
  check(file, ctx) {
    const findings = [...phraseFindings(file), ...repeatFindings(file)];
    if (file.kind === 'markdown') findings.push(...crossFileFindings(file, ctx));
    return findings;
  },
};

function phraseFindings(file: SourceFile): Finding[] {
  const report = reporter('redundancy', file);
  const findings: Finding[] = [];
  for (const prose of file.prose()) {
    const text = stripQuotes(prose.text);
    for (const { replacement, pattern } of phraseList()) {
      for (const match of text.matchAll(pattern)) {
        const found = match[0];
        const advice = replacement ? `use "${replacement}"` : 'delete it';
        const fix = replacement ? { line: prose.line, from: found, to: matchCase(found, replacement) } : undefined;
        findings.push(report(prose.line, `"${found}" is wordy; ${advice}.`, 'error', fix));
      }
    }
  }
  return findings;
}

function repeatFindings(file: SourceFile): Finding[] {
  const report = reporter('redundancy', file);
  const findings: Finding[] = [];
  const seenSentences = new Map<string, number>();
  const seenBlocks = new Map<string, number>();
  for (const block of file.blocks().filter((b) => b.context !== 'table' && b.context !== 'heading')) {
    const key = normalize(block.text);
    const firstBlock = seenBlocks.get(key);
    if (wordCount(block.text) >= MIN_PARAGRAPH_WORDS && firstBlock !== undefined) {
      findings.push(report(block.line, `Repeats the paragraph on line ${firstBlock}. Keep one copy.`));
      continue;
    }
    seenBlocks.set(key, block.line);
    for (const sentence of sentences(block.text).filter((s) => wordCount(s) >= MIN_SENTENCE_WORDS)) {
      const first = seenSentences.get(normalize(sentence));
      if (first !== undefined) findings.push(report(block.line, `Repeats a sentence from line ${first}.`, 'warning'));
      else seenSentences.set(normalize(sentence), block.line);
    }
  }
  return findings;
}

const otherFileCache = new Map<string, Set<string>>();

function crossFileFindings(file: SourceFile, ctx: RuleContext): Finding[] {
  const report = reporter('redundancy', file);
  const others = ctx.markdownFiles().filter((path) => path !== file.path);
  const findings: Finding[] = [];
  for (const block of file.blocks().filter((b) => b.context !== 'table' && wordCount(b.text) >= MIN_CROSS_FILE_WORDS)) {
    const key = normalize(block.text);
    const copy = others.find((path) => paragraphsOf(path, ctx).has(key));
    if (copy)
      findings.push(report(block.line, `Same paragraph appears in ${copy}. Link to it instead of copying.`, 'warning'));
  }
  return findings;
}

function paragraphsOf(path: string, ctx: RuleContext): Set<string> {
  const cached = otherFileCache.get(path);
  if (cached) return cached;
  const text = ctx.readRepoFile(path) ?? '';
  const keys = new Set(
    createSourceFile(path, text)
      .blocks()
      .map((b) => normalize(b.text)),
  );
  otherFileCache.set(path, keys);
  return keys;
}
