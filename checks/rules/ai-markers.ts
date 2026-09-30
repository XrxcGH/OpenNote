// Flags text that reads as machine-written: chatbot leftovers, stock filler phrases, heavy dash use,
// emoji headings and formulaic "**Label:** text" lists.

import type { Finding, Rule, SourceFile } from '../types.ts';
import { grade } from '../config.ts';
import { phrasePattern, stripQuotes, wordCount } from '../text.ts';
import { loadData, reporter } from './helpers.ts';

interface MarkerData {
  errors: string[];
  warnings: string[];
  emDashesPer1000Words: { warn: number; error: number };
  boldLeadListRatio: { warn: number; minItems: number };
}

interface Marker {
  phrase: string;
  pattern: RegExp;
  severity: 'error' | 'warning';
}

let cached: { data: MarkerData; markers: Marker[] } | undefined;

function markerData(): { data: MarkerData; markers: Marker[] } {
  if (cached) return cached;
  const data = loadData<MarkerData>('ai-markers.json');
  const toMarker =
    (severity: 'error' | 'warning') =>
    (phrase: string): Marker => ({ phrase, pattern: phrasePattern(phrase), severity });
  cached = { data, markers: [...data.errors.map(toMarker('error')), ...data.warnings.map(toMarker('warning'))] };
  return cached;
}

export const aiMarkers: Rule = {
  id: 'ai-markers',
  description: 'Chatbot leftovers, stock AI phrases, em dash overuse, emoji headings and formulaic lists.',
  appliesTo: (file) => file.kind !== 'data' && file.kind !== 'other',
  check(file) {
    return [...phraseFindings(file), ...dashFindings(file), ...emojiFindings(file), ...boldLeadFindings(file)];
  },
};

function phraseFindings(file: SourceFile): Finding[] {
  const report = reporter('ai-markers', file);
  const { markers } = markerData();
  const findings: Finding[] = [];
  for (const prose of file.prose()) {
    const text = stripQuotes(prose.text);
    for (const marker of markers) {
      marker.pattern.lastIndex = 0;
      if (!marker.pattern.test(text)) continue;
      const hint = marker.severity === 'error' ? 'Rewrite it in plain words.' : 'Prefer a plainer, more specific word.';
      findings.push(report(prose.line, `"${marker.phrase}" reads as AI-generated or filler. ${hint}`, marker.severity));
    }
  }
  return findings;
}

function dashFindings(file: SourceFile): Finding[] {
  const prose = file.prose().filter((p) => p.context !== 'table');
  const words = prose.reduce((sum, p) => sum + wordCount(p.text), 0);
  if (words < 150) return [];
  const dashLines = prose.filter((p) => /—|\s--\s/.test(p.text));
  const dashes = dashLines.reduce((sum, p) => sum + (p.text.match(/—|\s--\s/g) ?? []).length, 0);
  const rate = (dashes / words) * 1000;
  const severity = grade(rate, markerData().data.emDashesPer1000Words);
  if (!severity) return [];
  const density = `${dashes} em dashes in ${words} words (${rate.toFixed(1)} per 1,000)`;
  const message = `${density}. Use periods, commas or parentheses instead.`;
  return [reporter('ai-markers', file)(dashLines[0].line, message, severity)];
}

function emojiFindings(file: SourceFile): Finding[] {
  const report = reporter('ai-markers', file);
  return file
    .prose()
    .filter((p) => p.context === 'heading' && /\p{Extended_Pictographic}/u.test(p.text))
    .map((p) => report(p.line, 'Emoji in a heading. Keep headings plain text.', 'warning'));
}

function boldLeadFindings(file: SourceFile): Finding[] {
  if (file.kind !== 'markdown') return [];
  const items = file.prose().filter((p) => p.context === 'list' && /^\s*(?:[-*+]|\d+[.)])\s+/.test(p.raw));
  const bold = items.filter((p) => /^\s*(?:[-*+]|\d+[.)])\s+\*\*[^*]+\*\*/.test(p.raw));
  const { warn, minItems } = markerData().data.boldLeadListRatio;
  if (items.length < minItems || bold.length / items.length < warn) return [];
  const percent = Math.round((bold.length / items.length) * 100);
  const message = `${percent}% of list items start with a bold label. Vary the structure or use a table.`;
  return [reporter('ai-markers', file)(bold[0].line, message, 'warning')];
}
