// Grammar heuristics that are cheap and precise. Set CHECKS_LANGUAGETOOL_URL to also run a
// LanguageTool server (for example http://localhost:8081) for a full grammar check.

import type { Finding, ProseBlock, ProseLine, Rule, SourceFile } from '../types.ts';
import { sentences, stripQuotes } from '../text.ts';
import { reporter } from './helpers.ts';

const CONFUSIONS: [RegExp, string][] = [
  [/\b(could|should|would|must|might) of\b/gi, 'Use "have" after could, should or would ("could have").'],
  [/\balot\b/gi, 'Use "a lot".'],
  [/\bit's own\b/gi, 'Use "its own".'],
  [/\byour welcome\b/gi, 'Use "you\'re welcome".'],
  [/\birregardless\b/gi, 'Use "regardless".'],
  [
    /\b(more|less|better|worse|rather|greater|fewer|larger|smaller|faster|slower|higher|lower|easier|harder) then\b/gi,
    'Use "than" for comparisons.',
  ],
  [/\bloose (data|work|notes|changes|progress|your|their|the)\b/gi, 'Use "lose" (to misplace).'],
];

const SILENT_H = /^(hour|honest|honor|heir)/i;
const YOU_SOUND = /^(uni|use|usu|uti|ure|uri|uro|ura|ubi|eu|ewe|one\b|one-|onenote|once|u-)/i;
const VOWEL_LETTER_NAMES = 'AEFHILMNORSX';
const REPEAT_ALLOWED = new Set(['that', 'had', 'very']);
const LOWERCASE_STARTS = /^(iOS|iPadOS|iPhone|iPad|macOS|npm|git|e\.g\.|i\.e\.|vs\.|§)/;

export function expectedArticle(word: string): 'a' | 'an' | undefined {
  if (/^[0-9]/.test(word)) return undefined;
  const isLetterName = /^[A-Z][A-Z0-9]*s?$/.test(word) || /^[A-Za-z](-|$)/.test(word);
  if (isLetterName) return VOWEL_LETTER_NAMES.includes(word[0].toUpperCase()) ? 'an' : 'a';
  if (SILENT_H.test(word)) return 'an';
  if (YOU_SOUND.test(word)) return 'a';
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

export const grammar: Rule = {
  id: 'grammar',
  description: 'Articles, repeated words, common confusions, spacing, capitalization and brackets.',
  appliesTo: (file) => file.kind !== 'data' && file.kind !== 'other',
  async check(file) {
    const findings: Finding[] = [];
    for (const prose of file.prose()) findings.push(...checkLine(file, prose));
    for (const block of file.blocks()) findings.push(...checkBlock(file, block));
    findings.push(...(await languageTool(file)));
    return findings;
  },
};

function checkLine(file: SourceFile, prose: ProseLine): Finding[] {
  const report = reporter('grammar', file);
  const text = stripQuotes(prose.text);
  const findings: Finding[] = [];
  for (const [pattern, message] of CONFUSIONS) {
    if (pattern.test(text)) findings.push(report(prose.line, message));
    pattern.lastIndex = 0;
  }
  if (prose.context !== 'table') findings.push(...articleErrors(text).map((m) => report(prose.line, m)));
  for (const match of text.matchAll(/\b([A-Za-z]+)\s+\1\b/gi)) {
    if (!REPEAT_ALLOWED.has(match[1].toLowerCase())) findings.push(report(prose.line, `Repeated word "${match[1]}".`));
  }
  if (/[A-Za-z)]\s+[,;](\s|$)/.test(text))
    findings.push(report(prose.line, 'Remove the space before the comma or semicolon.'));
  if (/[a-z],[A-Za-z]/.test(text)) findings.push(report(prose.line, 'Add a space after the comma.', 'warning'));
  return findings;
}

function articleErrors(text: string): string[] {
  const messages: string[] = [];
  for (const match of text.matchAll(/(^|[.!?:]\s+|\s)(a|an|A|An)\s+([A-Za-z0-9][\w-]*)/g)) {
    const [, before, article, word] = match;
    const capitalized = article[0] === 'A';
    if (capitalized && before.trim() === '' && match.index !== 0) continue;
    const expected = expectedArticle(word);
    if (expected && expected !== article.toLowerCase())
      messages.push(`Use "${expected}" before "${word}", not "${article}".`);
  }
  return messages;
}

function checkBlock(file: SourceFile, block: ProseBlock): Finding[] {
  const report = reporter('grammar', file);
  const findings: Finding[] = [];
  if (block.context === 'paragraph' || block.context === 'quote') {
    sentences(block.text)
      .slice(1)
      .forEach((sentence) => {
        if (/^[a-z]/.test(sentence) && !LOWERCASE_STARTS.test(sentence)) {
          findings.push(
            report(block.line, `Sentence should start with a capital letter: "${sentence.slice(0, 30)}…"`, 'warning'),
          );
        }
      });
  }
  const opens = (block.text.match(/\(/g) ?? []).length;
  const closes = (block.text.match(/\)/g) ?? []).length;
  if (opens !== closes) findings.push(report(block.line, 'Unbalanced parentheses.', 'warning'));
  return findings;
}

interface LanguageToolMatch {
  message: string;
}

async function languageTool(file: SourceFile): Promise<Finding[]> {
  const url = process.env.CHECKS_LANGUAGETOOL_URL;
  if (!url || (file.kind !== 'markdown' && file.kind !== 'text')) return [];
  const report = reporter('grammar', file);
  const findings: Finding[] = [];
  for (const block of file.blocks().filter((b) => b.context !== 'table')) {
    const body = new URLSearchParams({ language: 'en-US', text: block.text, disabledCategories: 'TYPOS,TYPOGRAPHY' });
    const response = await fetch(`${url.replace(/\/$/, '')}/v2/check`, { method: 'POST', body });
    if (!response.ok) throw new Error(`LanguageTool returned HTTP ${response.status}`);
    const data = (await response.json()) as { matches: LanguageToolMatch[] };
    data.matches.forEach((m) => findings.push(report(block.line, `LanguageTool: ${m.message}`, 'warning')));
  }
  return findings;
}
