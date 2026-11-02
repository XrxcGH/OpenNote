// Makes docs/FEATURE-LIST.md: `npm run docs:features` writes it, and docsMatchCode.test.ts makes it again in memory,
// so a changed row that is not in the list fails CI. The list has four sources. Every command, title bar item, tool
// window, settings section, and setup step comes from docs/tools/registry.json. app/src/app/featureRegistry.test.ts
// writes that file from the live registries and checks it in CI. The feature sentences come from docs/FEATURES.md
// (featureRows.ts), and the pictures from docs/tools/screens.json. The words the registries lack are in
// featureMaps.ts and featureTools.ts.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAPTION_EXEMPT,
  CATEGORIES,
  COMMAND_PREFIX,
  ROW_CATEGORY,
  SCREEN_CATEGORY,
  SECTION_CATEGORY,
  TITLE_BAR,
  type Category,
} from './featureMaps.ts';
import { COMMAND_TEXT, SETTINGS_TEXT, SETUP_TEXT } from './featureCommands.ts';
import { entryName, entryText, firstSentence, rowName, sectionsOf, type Section } from './featureRows.ts';
import { TOOL_ENTRIES } from './featureTools.ts';

export { CATEGORIES, SCREEN_CATEGORIES, TITLE_BAR } from './featureMaps.ts';
export { sectionsOf } from './featureRows.ts';
export { TOOL_ENTRIES } from './featureTools.ts';

export interface Screen {
  /** The picture's name: docs/screens/<name>-light.png and <name>-dark.png. */
  name: string;
  /** What the picture is of, in the Screens page's category words. */
  category: string;
  caption: string;
}

/** What the app registers, as featureRegistry.test.ts writes it into docs/tools/registry.json. */
export interface Registry {
  commands: {
    id: string;
    title: string;
    category: string;
    keys: string[];
    flag?: string;
    palette?: false;
    about?: string;
  }[];
  titleBar: { id: string; side: string }[];
  tools: { id: string; title: string }[];
  settings: { id: string; title: string }[];
  setup: { id: string; title: string }[];
}
type Command = Registry['commands'][number];

/** The FEATURES.md sections that SECTION_CATEGORY does not place: the list cannot be made until they are. */
export const unplacedSections = (features: string) =>
  sectionsOf(features)
    .map((s) => s.title)
    .filter((title) => !SECTION_CATEGORY[title]);

/** The tool window a command opens or belongs to, if any. */
export function toolOfCommand(id: string): string | undefined {
  return Object.entries(TOOL_ENTRIES).find(
    ([tool, entry]) =>
      id === `tools.${tool}` || id.startsWith(`tools.${tool}.`) || (entry.tabs && id.startsWith(entry.tabs)),
  )?.[0];
}

/** The category of a command: its tool window's, else the longest COMMAND_PREFIX that starts its id. */
export function categoryOfCommand(command: { id: string }): Category | undefined {
  const tool = toolOfCommand(command.id);
  if (tool) return TOOL_ENTRIES[tool]!.category;
  const id = command.id;
  const prefix = Object.keys(COMMAND_PREFIX)
    .filter((p) => id === p || id.startsWith(`${p}.`) || (p.includes('.') && id.startsWith(p)))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? COMMAND_PREFIX[prefix] : undefined;
}

export const categoryOfTool = (id: string): Category | undefined => TOOL_ENTRIES[id]?.category;

const normal = (name: string) =>
  name
    .toLowerCase()
    .replace(/^open (the )?/, '')
    .replace(/ tools?$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const MINOR = new Set(['and', 'the', 'with', 'from', 'open', 'find', 'tool', 'tools']);
/** The words of a name that say what it is about, without a plural s. */
const keywords = (name: string) =>
  normal(name)
    .split(' ')
    .filter((w) => w.length > 3 && !MINOR.has(w))
    .map((w) => w.replace(/s$/, ''));
/** A tab's command title as a tab name: "Open the waves and sound tool" is "Waves and sound". */
const tabName = (title: string) => {
  const bare = title.replace(/^Open (the )?/, '').replace(/ tool$/, '');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
};
/** A command's sentence: its kit tab's own words, else its line in featureCommands.ts. */
export const commandText = (c: Command): string | undefined =>
  c.about ? `${firstSentence(c.about)}.` : COMMAND_TEXT[c.id];

/** The listed commands with no sentence, which the list cannot be made without. */
export function commandsWithoutText(registry: Registry, features: string): string[] {
  const src = sources(features, [], registry);
  const missing: string[] = [];
  for (const tool of registry.tools) {
    const entry = TOOL_ENTRIES[tool.id];
    if (!entry) continue;
    const tabs = registry.commands.filter((c) => c.id !== `tools.${tool.id}` && toolOfCommand(c.id) === tool.id);
    const rowOf = tabRows(sectionRows(src.sections, entry.section), tabs);
    missing.push(...tabs.filter((c) => !rowOf.has(c.id) && !commandText(c)).map((c) => c.id));
  }
  missing.push(...registry.commands.filter((c) => !toolOfCommand(c.id) && !commandText(c)).map((c) => c.id));
  return missing;
}

/** A command's title, marked when the palette leaves it out. */
const commandName = (c: Command) => (c.palette === false ? `${c.title} (not in the palette)` : c.title);
const cell = (text: string) => text.replace(/\|/g, '\\|');
const anchor = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');

const picture = (s: Screen) => [
  ...(CAPTION_EXEMPT[s.name] ? [`<!-- checks-disable-next-line ${CAPTION_EXEMPT[s.name]} -->`] : []),
  `**${s.name}.** ${s.caption} ([dark](screens/${s.name}-dark.png))`,
  '',
  ...(CAPTION_EXEMPT[s.name] ? [`<!-- checks-disable-next-line ${CAPTION_EXEMPT[s.name]} -->`] : []),
  `![${s.caption}](screens/${s.name}-light.png)`,
  '',
];

/** Everything the generator reads. */
interface Sources {
  sections: Section[];
  screens: readonly Screen[];
  registry: Registry;
  /** Each tool window's sentence. */
  sentence: Map<string, string>;
  /** The FEATURES.md rows that a tool window lists, so the Features lists leave them out. */
  used: Set<string>;
}

const sectionRows = (sections: readonly Section[], title?: string) =>
  title ? (sections.find((s) => s.title === title)?.entries ?? []) : [];

/** Reads the sources, and gives each tool window its sentence and its rows before any category is listed. */
function sources(features: string, screens: readonly Screen[], registry: Registry): Sources {
  const sections = sectionsOf(features);
  const rows = sections.flatMap((s) => s.entries);
  const src: Sources = { sections, screens, registry, sentence: new Map(), used: new Set() };
  for (const [id, entry] of Object.entries(TOOL_ENTRIES)) {
    const row = entry.feature ? rows.find((e) => entryName(e) === entry.feature) : undefined;
    if (entry.feature && !row) throw new Error(`FEATURES.md has no row named ${entry.feature} (tool ${id})`);
    src.sentence.set(id, row ? entryText(row) : `${entry.text}.`);
    for (const e of [...(row ? [row] : []), ...sectionRows(sections, entry.section)]) src.used.add(e);
  }
  return src;
}

/** The FEATURES.md rows that describe a tool window's tabs, with the tab each one belongs to. */
function tabRows(described: readonly string[], tabs: readonly Command[]): Map<string, string> {
  // A tab takes the row of its own name, or else the free row that shares the most words with it.
  const rowOf = new Map<string, string>();
  const free = (e: string) => ![...rowOf.values()].includes(e);
  const same = (a: string, b: string) => a === b || a.includes(b) || b.includes(a);
  for (const tab of tabs) {
    const row = described.find((e) => free(e) && rowName(e) && same(normal(rowName(e)), normal(tabName(tab.title))));
    if (row) rowOf.set(tab.id, row);
  }
  for (const tab of tabs) {
    if (rowOf.has(tab.id)) continue;
    const mine = keywords(tabName(tab.title));
    const best = described
      .filter((e) => free(e) && rowName(e))
      .map((e) => ({ e, score: keywords(rowName(e)).filter((w) => mine.includes(w)).length }))
      .sort((a, b) => b.score - a.score)[0];
    if (best && best.score > 0) rowOf.set(tab.id, best.e);
  }
  return rowOf;
}

/** A tool window: its sentence, picture, open command, and each tab with its row. */
function toolLines(src: Sources, tool: Registry['tools'][number]): string[] {
  const entry = TOOL_ENTRIES[tool.id]!;
  const out = [`#### ${tool.title}`, '', src.sentence.get(tool.id)!, ''];
  const shot = entry.screen ? src.screens.find((s) => s.name === entry.screen) : undefined;
  if (shot) out.push(...picture(shot));
  const open = src.registry.commands.find((c) => c.id === `tools.${tool.id}`);
  const keys = open?.keys.length ? ` (${open.keys.join(', ')})` : '';
  if (open) out.push(`Open it with the command "${open.title}"${keys}.`, '');
  const tabs = src.registry.commands.filter((c) => c.id !== `tools.${tool.id}` && toolOfCommand(c.id) === tool.id);
  const described = sectionRows(src.sections, entry.section);
  const rowOf = tabRows(described, tabs);
  if (tabs.length) {
    out.push(`Commands (${tabs.length}):`, '');
    for (const tab of tabs) {
      const row = rowOf.get(tab.id);
      const text = row ? entryText(row) : commandText(tab);
      out.push(`- **${tabName(tab.title)}.**${tab.palette === false ? ' Not in the palette.' : ''} ${text}`);
    }
    out.push('');
  }
  if (entry.parts) {
    out.push(`Tabs (${entry.parts.length}):`, '', ...entry.parts.map(([name, text]) => `- **${name}.** ${text}`), '');
  }
  const rest = described.filter((e) => ![...rowOf.values()].includes(e));
  if (rest.length) out.push(tabs.length ? 'Also in this window:' : 'In this window:', '', ...rest, '');
  return out;
}

/** The category's FEATURES.md rows, under the title of the section they come from, without repeats. */
function featureLines(src: Sources, category: Category): string[] {
  const groups = new Map<string, string[]>();
  const names = new Set<string>();
  for (const s of src.sections) {
    for (const e of s.entries) {
      const moved = ROW_CATEGORY.find(([pattern]) => pattern.test(e))?.[1];
      const placed = moved ?? SECTION_CATEGORY[s.title];
      const name = entryName(e) || e;
      if (src.used.has(e) || placed !== category || names.has(name)) continue;
      names.add(name);
      // A row from a section about something else goes under More, since its section's title would mislead.
      const title = moved && moved !== SECTION_CATEGORY[s.title] ? 'More' : s.title.replace(/^Phase \d+: /, '');
      groups.set(title, [...(groups.get(title) ?? []), e]);
    }
  }
  if (!groups.size) return [];
  // More comes last.
  const ordered = [...groups].sort(([a], [b]) => Number(a === 'More') - Number(b === 'More'));
  return ['### Features', '', ...ordered.flatMap(([title, rows]) => [`#### ${title}`, '', ...rows, ''])];
}

/** The lists only one category has: the title bar, and the settings sections and setup steps. */
function registryLines(src: Sources, category: Category): string[] {
  if (category === 'Notebooks and navigation') {
    const items = src.registry.titleBar.flatMap((item) => (TITLE_BAR[item.id] ? [TITLE_BAR[item.id]!] : []));
    return ['### Title bar', '', ...items.map((item) => `- **${item.name}.** ${item.text}`), ''];
  }
  if (category !== 'Settings and accessibility') return [];
  return [
    '### Settings sections',
    '',
    ...src.registry.settings.map((s) => `- **${s.title}.** ${SETTINGS_TEXT[s.id]}`),
    '',
    '### First-run setup steps',
    '',
    ...src.registry.setup.map((s) => `- **${s.title}.** ${SETUP_TEXT[s.id]}`),
    '',
  ];
}

/** One category: its features, its own lists, its tool windows, its other commands, and its other pictures. */
function categoryLines(src: Sources, category: Category): string[] {
  const out = [`## ${category}`, '', ...featureLines(src, category), ...registryLines(src, category)];
  const tools = src.registry.tools
    .filter((t) => TOOL_ENTRIES[t.id]?.category === category)
    .sort((a, b) => a.title.localeCompare(b.title));
  const kits = category === 'Engineering kits' || category === 'Subject and catalog kits';
  if (tools.length) out.push(kits ? '### Kits' : '### Tool windows', '', ...tools.flatMap((t) => toolLines(src, t)));
  const commands = src.registry.commands.filter((c) => categoryOfCommand(c) === category && !toolOfCommand(c.id));
  if (commands.length) {
    out.push('### Commands', '', '| Command | What it does | Default keys |', '| --- | --- | --- |');
    out.push(
      ...commands.map((c) => `| ${cell(commandName(c))} | ${cell(commandText(c)!)} | ${cell(c.keys.join(', '))} |`),
      '',
    );
  }
  const shown = new Set(Object.values(TOOL_ENTRIES).flatMap((e) => (e.screen ? [e.screen] : [])));
  const shots = src.screens.filter(
    (s) => !shown.has(s.name) && (SCREEN_CATEGORY[s.name] ?? SCREEN_CATEGORY[s.category]) === category,
  );
  if (shots.length) out.push('### Pictures', '', ...shots.flatMap(picture));
  return out;
}

function introLines(registry: Registry): string[] {
  const kits = registry.tools.filter((t) => TOOL_ENTRIES[t.id]?.kit).length;
  return [
    '# OpenNote feature list',
    '',
    'Every tool, action, and feature in OpenNote, grouped by category, with one sentence each. ' +
      '`npm run docs:features` makes this page. The commands, tool windows, title bar items, settings sections, and ' +
      'setup steps come from what the app registers, so a new one shows up here or fails the tests. The feature ' +
      'sentences come from [FEATURES.md](FEATURES.md), which also says what has been tested by hand and which flag ' +
      'turns each one on. The [help pages](help/README.md) explain how to use them. [docs/screens](screens/README.md) ' +
      'has every picture in light and dark.',
    '',
    `The app registers ${registry.commands.length} commands and ${registry.tools.length} tool windows. ${kits} of the ` +
      'windows are subject and engineering kits. The count includes the ink commands, which register when a page ' +
      'first shows its ink, and the commands that register once start-up is done or with the first page: on-device ' +
      'intelligence, the second pass of page commands, and the code block and table commands. The ' +
      'command palette (Ctrl+K) runs every command not marked as left out of it. Some commands need a feature ' +
      'flag, which FEATURES.md names. The keys shown are the defaults of the standard shortcut set.',
    '',
    '## Contents',
    '',
    ...CATEGORIES.map((c) => `- [${c}](#${anchor(c)})`),
    '',
  ];
}

export function generateFeatureList(features: string, screens: readonly Screen[], registry: Registry): string {
  const unplaced = unplacedSections(features);
  if (unplaced.length) throw new Error(`Give these FEATURES.md sections a category: ${unplaced.join('; ')}`);
  const bare = commandsWithoutText(registry, features);
  if (bare.length) throw new Error(`Give these commands a sentence in featureCommands.ts: ${bare.join(', ')}`);
  const unsaid = [
    ...registry.settings.filter((s) => !SETTINGS_TEXT[s.id]),
    ...registry.setup.filter((s) => !SETUP_TEXT[s.id]),
  ];
  if (unsaid.length)
    throw new Error(`Give these a sentence in featureCommands.ts: ${unsaid.map((s) => s.id).join(', ')}`);
  const src = sources(features, screens, registry);
  const lines = [...introLines(registry), ...CATEGORIES.flatMap((c) => categoryLines(src, c))];
  return lines.join('\n').replace(/\n+$/, '\n');
}

const root = join(import.meta.dirname, '..', '..');
export const readScreens = (): Screen[] =>
  JSON.parse(readFileSync(join(root, 'docs', 'tools', 'screens.json'), 'utf8')) as Screen[];
export const readRegistry = (): Registry =>
  JSON.parse(readFileSync(join(root, 'docs', 'tools', 'registry.json'), 'utf8')) as Registry;
export const regenerate = () =>
  generateFeatureList(readFileSync(join(root, 'docs', 'FEATURES.md'), 'utf8'), readScreens(), readRegistry());

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  // The registry test writes registry.json from the live registries first, unless --no-registry says not to.
  if (!process.argv.includes('--no-registry')) {
    const run = spawnSync(
      'npx vitest run --config app/vitest.config.ts --project unit app/src/app/featureRegistry.test.ts',
      { cwd: root, shell: true, stdio: 'inherit', env: { ...process.env, OPENNOTE_WRITE_REGISTRY: '1' } },
    );
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
  writeFileSync(join(root, 'docs', 'FEATURE-LIST.md'), regenerate());
}
