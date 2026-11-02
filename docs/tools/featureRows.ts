// Reads the feature rows of docs/FEATURES.md for the feature list (featureList.ts): one short sentence for each
// table row or bullet, grouped by the section it sits in.

import { SHORT } from './featureShort.ts';

const SKIPPED = /^(Contents|How to read the status|Screens)$/;

/** CHECKS warns about a sentence over 30 words, so a longer one takes its short form from featureShort.ts. */
const MAX_WORDS = 30;

/** At most 30 words: a longer sentence is replaced by its short form, written by hand. */
function shortened(sentence: string): string {
  if (sentence.split(' ').length <= MAX_WORDS) return sentence;
  const short = SHORT[sentence.slice(0, 40)];
  if (!short) throw new Error(`Give this sentence a short form in docs/tools/featureShort.ts: ${sentence}`);
  return short;
}

/** Words whose full stop does not end a sentence. */
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|vs|approx|Fig|No|Eq|cf|al|St|Dr|Mr|Mrs|Ms|U\.S)\.$/;

/** Where the sentences of a text end: a stop before a capital, outside parentheses, and not after an abbreviation. */
export function sentenceStops(clean: string): number[] {
  const stops: number[] = [];
  let depth = 0;
  let code = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]!;
    // Code such as `![[` is not text, so its brackets do not count.
    if (ch === '`') code = !code;
    else if (code) continue;
    else if (ch === '(' || ch === '[') depth += 1;
    else if ((ch === ')' || ch === ']') && depth > 0) depth -= 1;
    else if (depth === 0 && '.!?'.includes(ch) && /^\s+[A-Z`"(]/.test(clean.slice(i + 1, i + 3))) {
      if (ch === '.' && ABBREVIATION.test(clean.slice(Math.max(0, i - 8), i + 1))) continue;
      stops.push(i);
    }
  }
  return stops;
}

/** True when every parenthesis of a text, outside code, is closed. */
export const balanced = (text: string) => {
  let depth = 0;
  for (const ch of text.replace(/`[^`]*`/g, '')) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
};

/** The first sentence of a piece of text, without its final full stop. A sentence under five words takes the next. */
export function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const stops = sentenceStops(clean);
  const end = stops.find((at) => clean.slice(0, at).split(' ').length >= 5) ?? clean.length;
  const sentence = clean.slice(0, end).replace(/[.]$/, '').trim();
  return shortened(sentence.charAt(0).toUpperCase() + sentence.slice(1));
}

const withoutStatus = (text: string) => text.replace(/\s*Status:.*$/, '').trim();
const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
const isRule = (row: string) => /^\|?[\s:|-]+\|?$/.test(row);

/** The list entry for one table row, given the table's header cells. */
function rowEntry(header: string[], row: string[]): string | null {
  const name = row[0]!.replace(/^\*\*|\*\*$/g, '');
  if (!name) return null;
  const importAt = header.indexOf('Import');
  const exportAt = header.indexOf('Export');
  if (importAt > 0 && exportAt > 0) {
    const parts = [];
    const imports = firstSentence(row[importAt] ?? '');
    const exports = firstSentence(row[exportAt] ?? '');
    if (imports && !/^(none|\(none\))$/i.test(imports)) parts.push(`Imports ${imports}`);
    if (exports && !/^(none|\(none\))$/i.test(exports))
      parts.push(`${parts.length ? 'exports' : 'Exports'} ${exports}`);
    return `- **${name}.** ${parts.join(' and ')}.`;
  }
  // The description is the first cell after the name that is not a status.
  const body = row
    .slice(1)
    .find((c, i) => c && !(i === row.length - 2 && /^(Built|Not built|Needs the owner)/.test(c)));
  return body ? `- **${name}.** ${firstSentence(withoutStatus(body))}.` : null;
}

function bulletEntry(text: string): string {
  const named = /^\*\*(.+?)[:.]\*\*\s*(.*)$/.exec(text);
  if (named) return `- **${named[1]}.** ${firstSentence(withoutStatus(named[2]!))}.`;
  return `- ${firstSentence(withoutStatus(text))}.`;
}

export interface Section {
  /** The `##` title, or the `###` title under it. */
  title: string;
  entries: string[];
}

/** The sections of FEATURES.md that list features, each `###` part on its own. */
export function sectionsOf(features: string): Section[] {
  const sections: Section[] = [];
  let parent = '';
  let current: Section | null = null;
  let header: string[] | null = null;
  for (const line of features.split('\n')) {
    const heading = /^(##|###) (.+)$/.exec(line);
    if (heading) {
      if (heading[1] === '##') parent = heading[2]!.trim();
      current = SKIPPED.test(parent) ? null : { title: heading[2]!.trim(), entries: [] };
      if (current) sections.push(current);
      header = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('|')) {
      if (isRule(line)) continue;
      if (!header) {
        header = cells(line);
        continue;
      }
      const entry = rowEntry(header, cells(line));
      if (entry) current.entries.push(entry);
      continue;
    }
    header = null;
    const bullet = /^(?:- |\d+\. )(.+)$/.exec(line);
    if (bullet) current.entries.push(bulletEntry(bullet[1]!));
  }
  // A parent heading with no entries of its own, such as a heading over `###` parts, is not listed.
  return sections.filter((s) => s.entries.length > 0);
}

/** An entry's bold name, or "". */
export const entryName = (entry: string) => /^- \*\*(.+?)\.\*\*/.exec(entry)?.[1] ?? '';
/** An entry's name: its bold name, or the words before a colon, as in "Soils: phase relations". */
export const rowName = (entry: string) => entryName(entry) || (/^- ([^:*]{1,60}):/.exec(entry)?.[1] ?? '');
/** An entry without its bullet and bold name. */
export const entryText = (entry: string) => entry.replace(/^- \*\*.+?\.\*\*\s*/, '').replace(/^- /, '');
