// Length limits: long sentences, paragraphs and sections in prose, and long lines in code.

import type { Finding, Rule, SourceFile, Threshold } from '../types.ts';
import { grade, threshold } from '../config.ts';
import { sentences, wordCount } from '../text.ts';
import { isProseFile, reporter } from './helpers.ts';

const DEFAULTS = {
  sentenceWords: { warn: 30, error: 45 },
  paragraphWords: { warn: 90, error: 150 },
  sectionWords: { warn: 400, error: 700 },
  codeLineChars: { warn: 120, error: 140 },
};

export const length: Rule = {
  id: 'length',
  description: 'Sentence, paragraph and section length in prose; line length in code.',
  appliesTo: (file) => isProseFile(file) || file.kind === 'code',
  check(file, ctx) {
    const limit = (key: keyof typeof DEFAULTS) => threshold(ctx.settings, key, DEFAULTS[key]);
    const findings = proseFindings(file, limit('sentenceWords'), limit('paragraphWords'));
    if (isProseFile(file)) findings.push(...sectionFindings(file, limit('sectionWords')));
    if (file.kind === 'code') findings.push(...lineFindings(file, limit('codeLineChars')));
    return findings;
  },
};

function proseFindings(file: SourceFile, sentenceLimit: Threshold, paragraphLimit: Threshold): Finding[] {
  const report = reporter('length', file);
  const findings: Finding[] = [];
  for (const block of file.blocks().filter((b) => b.context !== 'table' && b.context !== 'heading')) {
    const blockWords = wordCount(block.text);
    const paragraphSeverity = grade(blockWords, paragraphLimit);
    if (paragraphSeverity) {
      findings.push(
        report(
          block.line,
          `Paragraph has ${blockWords} words (limit ${paragraphLimit.warn}). Split it or use a list.`,
          paragraphSeverity,
        ),
      );
    }
    for (const sentence of sentences(block.text)) {
      const count = wordCount(sentence);
      const severity = grade(count, sentenceLimit);
      if (severity)
        findings.push(
          report(
            block.line,
            `Sentence has ${count} words (limit ${sentenceLimit.warn}): "${sentence.slice(0, 40)}…"`,
            severity,
          ),
        );
    }
  }
  return findings;
}

function sectionFindings(file: SourceFile, limit: Threshold): Finding[] {
  const report = reporter('length', file);
  const findings: Finding[] = [];
  let sectionLine = 1;
  let sectionWords = 0;
  const close = () => {
    const severity = grade(sectionWords, limit);
    if (severity)
      findings.push(
        report(
          sectionLine,
          `Section has ${sectionWords} words (limit ${limit.warn}). Add subheadings or move detail elsewhere.`,
          severity,
        ),
      );
  };
  for (const block of file.blocks()) {
    if (block.context === 'heading') {
      close();
      sectionLine = block.line;
      sectionWords = 0;
    } else if (block.context !== 'table') {
      sectionWords += wordCount(block.text);
    }
  }
  close();
  return findings;
}

function lineFindings(file: SourceFile, limit: Threshold): Finding[] {
  const report = reporter('length', file);
  const findings: Finding[] = [];
  file.lines.forEach((raw, index) => {
    if (/https?:\/\//.test(raw)) return;
    const severity = grade(raw.length, limit);
    if (severity)
      findings.push(report(index + 1, `Line has ${raw.length} characters (limit ${limit.warn}).`, severity));
  });
  return findings;
}
