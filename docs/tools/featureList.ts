// Makes docs/FEATURE-LIST.md from docs/FEATURES.md and docs/tools/screens.json: `npm run docs:features` writes it, and
// docsMatchCode.test.ts regenerates it in memory, so a new feature or a changed row that is not in the list fails CI.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Screen {
  /** The picture's name: docs/screens/<name>-light.png and <name>-dark.png. */
  name: string;
  /** What the picture is of, in the list's category words. */
  category: string;
  caption: string;
}

/** The categories of the Screens section, in order. Every category needs a picture (docsMatchCode.test.ts). */
export const SCREEN_CATEGORIES = [
  'First-time setup',
  'The workspace',
  'Writing and drawing',
  'Find, link, and record',
  'Study',
  'Graphs, math, and tools',
  'Import and export',
  'Connectors and sync',
  'Settings',
  'Trash, the palette, and tool windows',
] as const;

const SKIPPED = /^(Contents|How to read the status|Screens)$/;

const MAX_WORDS = 44;

/** At most 44 words, since the checks fail a sentence of 45: cut at the last comma or semicolon, else at the last word. */
function shortened(sentence: string): string {
  const words = sentence.split(' ');
  if (words.length <= MAX_WORDS) return sentence;
  const head = words.slice(0, MAX_WORDS).join(' ');
  const cut = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'));
  const text = cut > head.length / 2 ? head.slice(0, cut) : head;
  return text.replace(/,?\s+(and|or|the|a|of|to|with)$/, '').replace(/[,;:]$/, '');
}

/** The first sentence of a piece of text, without its final full stop. */
function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const stop = /[.!?](?=\s+[A-Z`"(])/.exec(clean);
  const sentence = (stop ? clean.slice(0, stop.index) : clean).replace(/[.]$/, '').trim();
  return shortened(sentence);
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
    return `- **${name}.** ${parts.join(' and ')}`;
  }
  // The description is the first cell after the name that is not a status.
  const body = row
    .slice(1)
    .find((c, i) => c && !(i === row.length - 2 && /^(Built|Not built|Needs the owner)/.test(c)));
  return body ? `- **${name}.** ${firstSentence(withoutStatus(body))}` : null;
}

function bulletEntry(text: string): string {
  const named = /^\*\*(.+?)[:.]\*\*\s*(.*)$/.exec(text);
  if (named) return `- **${named[1]}.** ${firstSentence(withoutStatus(named[2]!))}`;
  return `- ${firstSentence(withoutStatus(text))}`;
}

interface Section {
  title: string;
  entries: string[];
}

/** The sections of FEATURES.md that list features, with a `###` shown as `## Parent: Child`. */
export function sectionsOf(features: string): Section[] {
  const sections: Section[] = [];
  let parent = '';
  let current: Section | null = null;
  let header: string[] | null = null;
  for (const line of features.split('\n')) {
    const h2 = /^## (.+)$/.exec(line);
    const h3 = /^### (.+)$/.exec(line);
    if (h2 || h3) {
      parent = h2 ? h2[1]!.trim() : parent;
      const title = h2 ? parent : `${parent}: ${h3![1]!.trim()}`;
      current = SKIPPED.test(parent) ? null : { title, entries: [] };
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

const anchor = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');

export function generateFeatureList(features: string, screens: readonly Screen[]): string {
  const sections = sectionsOf(features);
  const out: string[] = [
    '# OpenNote feature list',
    '',
    'Every tool, action, and feature in OpenNote, grouped by category, with one sentence each. This list is made from ' +
      '[FEATURES.md](FEATURES.md) by `npm run docs:features`. FEATURES.md also says what has been tested by hand, what ' +
      'waits on an account or a device, and which flag turns each one on. The [help pages](help/README.md) explain how ' +
      'to use them. Pictures of every major page are at the end, in light. [docs/screens](screens/README.md) has them ' +
      'in dark too.',
    '',
    '## Contents',
    '',
    ...sections.map((s) => `- [${s.title}](#${anchor(s.title)})`),
    '- [Screens](#screens)',
    '',
  ];
  for (const s of sections) out.push(`## ${s.title}`, '', ...s.entries, '');
  out.push('## Screens', '');
  for (const category of SCREEN_CATEGORIES) {
    const shown = screens.filter((s) => s.category === category);
    if (!shown.length) continue;
    out.push(`### ${category}`, '');
    for (const s of shown) {
      out.push(`**${s.name}.** ${s.caption} ([dark](screens/${s.name}-dark.png))`, '');
      out.push(`![${s.caption}](screens/${s.name}-light.png)`, '');
    }
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

const root = join(import.meta.dirname, '..', '..');
export const readScreens = (): Screen[] =>
  JSON.parse(readFileSync(join(root, 'docs', 'tools', 'screens.json'), 'utf8')) as Screen[];
export const regenerate = () =>
  generateFeatureList(readFileSync(join(root, 'docs', 'FEATURES.md'), 'utf8'), readScreens());

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  writeFileSync(join(root, 'docs', 'FEATURE-LIST.md'), regenerate());
}
