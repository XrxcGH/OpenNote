// Reads the feature rows of docs/FEATURES.md for the feature list (featureList.ts): one short sentence for each
// table row or bullet, grouped by the section it sits in.

const SKIPPED = /^(Contents|How to read the status|Screens)$/;

/** CHECKS warns about a sentence over 30 words, so a longer one is cut. */
const MAX_WORDS = 30;

/** At most 30 words: cut at the last comma or semicolon, else at the last word, and keep a cut list a list. */
function shortened(sentence: string): string {
  const words = sentence.split(' ');
  if (words.length <= MAX_WORDS) return sentence;
  const head = words.slice(0, MAX_WORDS).join(' ');
  const cut = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'));
  let text = (cut > 0 ? head.slice(0, cut) : head).replace(/,?\s+(and|or|the|a|of|to|with)$/, '').replace(/[,;:]$/, '');
  // "a, b, c, d" lost its "and d" in the cut, so the last item takes the "and".
  const last = text.lastIndexOf(', ');
  if (last > 0 && !/^, (and|or) /.test(text.slice(last)) && text.slice(0, last).includes(','))
    text = `${text.slice(0, last)}, and ${text.slice(last + 2)}`;
  return text;
}

/** The first sentence of a piece of text, without its final full stop. A sentence under five words takes the next. */
export function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const stops = [...clean.matchAll(/[.!?](?=\s+[A-Z`"(])/g)].map((m) => m.index);
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
