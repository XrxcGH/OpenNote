// The NVDA checklist (A4-42): what a person with a screen reader and no mouse would check first, written as data
// so a script can run it. The spec that drives NVDA is nvda.spec.ts. This file has no Playwright and no NVDA code,
// so a plain Node test can check it.
//
// Each item sets up a place in the app, sends keys, and lists the phrases NVDA must say, in order. A phrase is a
// case-insensitive regular expression. Phrases are loose on purpose: they name the roles and accessible names the
// app sets, not NVDA's exact wording, which changes between NVDA versions. The full spoken log goes into the
// results, so a failing item shows what NVDA said instead.

export type Setup =
  | { readonly role: 'tree'; readonly name: string; readonly item: string }
  | { readonly role: 'tab' | 'textbox'; readonly name: string }
  | { readonly role: 'page' };

export interface Item {
  readonly id: string;
  readonly title: string;
  /** Which part of docs/testing/keyboard-and-screen-reader.md the item covers. */
  readonly covers: string;
  /** Where focus starts. The page is open with a short note in it. */
  readonly setup: Setup;
  /** Keys NVDA sends, in order. A key is a name Playwright knows, or a letter for browse mode quick navigation. */
  readonly keys: readonly string[];
  /** Phrases NVDA must say, in this order. */
  readonly expect: readonly string[];
  /**
   * Has NVDA report the control that has focus before the keys. A focus moved by script is not spoken by NVDA as it
   * lands, so the item asks for it, as a person would with NVDA+Tab.
   */
  readonly reportFocus?: boolean;
}

export const ITEMS: readonly Item[] = [
  {
    id: 'landmarks',
    title: 'Landmarks can be reached with the D key',
    covers: 'Phase 2: navigation',
    setup: { role: 'page' },
    keys: ['d', 'd', 'd', 'd', 'd', 'd'],
    expect: ['Notebooks', 'Pages', 'main'],
  },
  {
    id: 'headings',
    title: 'Headings read with their level, in order',
    covers: 'Phase 4: typed notes',
    setup: { role: 'page' },
    // The reading cursor stays where the last item left it (past the last landmark), so this starts at the top.
    keys: ['Control+Home', 'h', 'h'],
    expect: ['heading', 'Short note'],
  },
  {
    id: 'notebook-tree',
    title: 'The notebook tree reads each item and its level',
    covers: 'Phase 2: navigation',
    setup: { role: 'tree', name: 'Notebooks', item: 'Lectures' },
    keys: ['ArrowDown'],
    expect: ['Lectures', 'Labs'],
    reportFocus: true,
  },
  {
    id: 'command-tabs',
    title: 'The command tabs read as tabs, and the arrow keys move between them',
    covers: 'Phase 2: command bar',
    setup: { role: 'tab', name: 'Home' },
    keys: ['ArrowRight'],
    expect: ['Home', 'Insert'],
    reportFocus: true,
  },
  {
    id: 'page-text',
    title: 'The page text box says what it is when focus enters it',
    covers: 'Phase 4: typed notes',
    setup: { role: 'textbox', name: 'Page text' },
    keys: [],
    expect: ['Page text', 'edit'],
    reportFocus: true,
  },
  {
    id: 'palette',
    title: 'The command palette says its name when it opens',
    covers: 'Phase 2: command palette',
    setup: { role: 'page' },
    keys: ['Control+k'],
    // NVDA says the dialog's name and role when it opens. With the first result active, it then names that result,
    // not the search box, because the box points at it with aria-activedescendant.
    expect: ['Command palette', 'dialog'],
  },
];

/** What to do when Guidepup cannot find NVDA, shown in place of its own short message. */
export const NVDA_MISSING_HELP = [
  'NVDA is not installed where Guidepup looks for it.',
  'Guidepup needs two steps, from the tests/nvda folder, on Windows:',
  '  npm ci',
  '  npx guidepup setup --ci     (prepares Windows once per machine)',
  '  npx guidepup install nvda   (downloads the NVDA build the pinned Guidepup version needs)',
  'The nightly workflow runs them as "Install Guidepup" and "Set up the machine for NVDA". See docs/HARDENING.md.',
].join('\n');

/**
 * Turns the error from starting NVDA into one that says how to fix a missing install. Any other error is returned
 * as it is, because it says something different.
 */
export function explainStartFailure(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/not installed/i.test(message)) {
    const said = message.split('\n')[0];
    return new Error(`${NVDA_MISSING_HELP}\n\nGuidepup said: ${said}`, { cause: error });
  }
  return error instanceof Error ? error : new Error(message);
}

/**
 * Finds the phrases in the spoken log, in order. A phrase may be said in the same line as the one before it. It
 * returns the phrases that were not found, which is empty when the item passes.
 */
export function missingPhrases(spoken: readonly string[], expected: readonly string[]): string[] {
  const missing: string[] = [];
  let line = 0;
  for (const phrase of expected) {
    const pattern = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    let found = -1;
    for (let i = line; i < spoken.length; i += 1) {
      if (pattern.test(spoken[i])) {
        found = i;
        break;
      }
    }
    if (found < 0) missing.push(phrase);
    else line = found;
  }
  return missing;
}

export interface Result {
  readonly id: string;
  readonly title: string;
  readonly covers: string;
  readonly pass: boolean;
  readonly missing: readonly string[];
  readonly spoken: readonly string[];
}

export function result(item: Item, spoken: readonly string[]): Result {
  const missing = missingPhrases(spoken, item.expect);
  return { id: item.id, title: item.title, covers: item.covers, pass: missing.length === 0, missing, spoken };
}

export interface Run {
  /** The NVDA version, from the machine that ran it. */
  readonly nvda: string;
  readonly browser: string;
  readonly date: string;
  readonly results: readonly Result[];
}

const cell = (text: string) => text.replace(/[\\|]/g, '\\$&').replace(/\s+/g, ' ').trim();

/** The run as a Markdown table, for the job summary and for docs/testing/keyboard-and-screen-reader.md. */
export function table(run: Run): string {
  const lines = [
    `NVDA ${run.nvda} in ${run.browser}, ${run.date}.`,
    '',
    '| Item | Covers | Result | Missing |',
    '|---|---|---|---|',
    ...run.results.map(
      (r) =>
        `| ${cell(r.title)} | ${cell(r.covers)} | ${r.pass ? 'Pass' : 'Fail'} | ${cell(r.missing.join(', ')) || 'None'} |`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

export function failures(run: Run): string[] {
  return run.results.filter((r) => !r.pass).map((r) => `${r.id}: NVDA did not say ${r.missing.join(', ')}`);
}
