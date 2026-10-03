// @vitest-environment jsdom
// Every page command WP4 registers, run through the command registry on a real page over the memory service. Each
// case checks the Markdown after the command and that one page undo brings the text back. Key cases check which
// command a chord reaches in an editor, in both shortcut sets. A coverage test fails on a command without a case.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../registrations/editor';
import '../registrations/sync';
import { commandForKey } from '../../../commands/dispatcher';
import { executeCommand } from '../../../commands/registry';
import { createMarkdownCache, serializeTextBlock } from '../../../editor/markdown';
import { commands } from '../../../registries';
import { DEFAULT_SETTINGS, settingsStore } from '../../../state/settings';
import { PAGE_KEYS } from '../keys';
import type { PageCommandId } from '../keys';
import { selectOnPage } from '../seams/selectionStore';
import { md } from '../test/builders';
import { textPageFixture } from '../test/fixtures';
import { cleanupPages, renderPage } from '../test/harness';
import type { PageHarness } from '../test/harness';

afterEach(async () => {
  await cleanupPages();
  settingsStore.set({ settings: DEFAULT_SETTINGS, readOnly: false });
  vi.useRealTimers();
});

const cache = createMarkdownCache();

/** A page with one text block holding `before`, its selection marked as in `md`, with the editor focused. */
async function open(before: string): Promise<{ page: PageHarness; block: string }> {
  const marked = md(before);
  const fixture = textPageFixture(serializeTextBlock(marked.doc, cache));
  const block = fixture.page.blocks[0].id;
  const page = await renderPage({ fixture });
  const editor = page.mounted.pool.mount(
    block,
    { kind: 'selection', anchor: marked.anchor, head: marked.head },
    'target',
  );
  editor?.commands.focus();
  return { page, block };
}

function editorMarkdown(page: PageHarness, block: string): string {
  return serializeTextBlock(page.mounted.pool.editor(block)!.state.doc, cache);
}

interface Case {
  before: string;
  after: string;
  args?: unknown;
  /** Blocks selected as objects, for pageObject commands. */
  objects?: boolean;
}

/** Runs the case, checks the Markdown the service holds, then undoes and checks the text is back. */
async function expectCase(id: string, { before, after, args, objects }: Case): Promise<void> {
  const { page, block } = await open(before);
  const original = editorMarkdown(page, block);
  if (objects) selectOnPage({ blocks: [block], strokes: [] });
  expect(await executeCommand(id as PageCommandId, args), `${id} ran`).toBe(true);
  await page.mounted.sync.flushAll('command');
  expect(page.markdown(block), id).toBe(after);
  await page.mounted.sync.undo();
  expect(editorMarkdown(page, block), `${id} undone`).toBe(original);
}

const NOW = new Date('2026-09-30T14:05:00');

const CASES: Partial<Record<PageCommandId | 'link.remove' | 'link.edit', Case>> = {
  'format.bold': { before: 'a [b] c', after: 'a **b** c' },
  'format.italic': { before: 'a [b] c', after: 'a *b* c' },
  'format.underline': { before: 'a [b] c', after: 'a <u>b</u> c' },
  'format.strike': { before: 'a [b] c', after: 'a ~~b~~ c' },
  'format.highlight': { before: 'a [b] c', after: 'a ==b== c' },
  'format.code': { before: 'a [b] c', after: 'a `b` c' },
  'format.subscript': { before: 'H[2]O', after: 'H<sub>2</sub>O' },
  'format.superscript': { before: 'x[2]', after: 'x<sup>2</sup>' },
  'format.larger': { before: 'a [b] c', after: 'a <span data-size="large">b</span> c' },
  'format.smaller': { before: 'a [b] c', after: 'a <span data-size="small">b</span> c' },
  'format.textColor': { before: 'a [b] c', after: 'a <span data-color="fern">b</span> c', args: { color: 'fern' } },
  'format.textSize': { before: 'a [b] c', after: 'a <span data-size="xlarge">b</span> c', args: { size: 'xlarge' } },
  'format.clear': { before: 'a **[b]** c', after: 'a b c' },
  'format.clearAll': { before: '# **[Title]**', after: 'Title' },
  'format.link': { before: 'a [b] c', after: 'a [b](https://example.com) c', args: { href: 'example.com' } },
  'block.normal': { before: '## [Title]', after: 'Title' },
  'block.heading1': { before: '[Title]', after: '# Title' },
  'block.heading2': { before: '[Title]', after: '## Title' },
  'block.heading3': { before: '[Title]', after: '### Title' },
  'block.heading4': { before: '[Title]', after: '#### Title' },
  'block.heading5': { before: '[Title]', after: '##### Title' },
  'block.heading6': { before: '[Title]', after: '###### Title' },
  'block.bulletList': { before: 'one[]', after: '- one' },
  'block.orderedList': { before: 'one[]', after: '1. one' },
  'block.checklist': { before: 'one[]', after: '- [ ] one' },
  'block.todoCycle': { before: '- [ ] one[]', after: '- [x] one' },
  'block.toggleCheck': { before: '- [x] one[]', after: '- [ ] one' },
  'block.quote': { before: 'one[]', after: '> one' },
  'block.codeBlock': { before: '**one**[]', after: '```\none\n```' },
  'block.callout': { before: 'one[]', after: '> [!note]\n>\n> one' },
  'block.divider': { before: 'one[]', after: 'one\n\n---' },
  'block.turnInto': { before: '- one[]', after: '### one', args: { kind: 'heading3' } },
  'insert.date': { before: 'On []', after: 'On Sep 30, 2026' },
  'insert.time': { before: 'At []', after: 'At 2:05 PM' },
  'insert.dateTime': { before: 'At []', after: 'At Sep 30, 2026 2:05 PM' },
  'outline.moveUp': { before: '- one\n- t[]wo', after: '- two\n- one' },
  'outline.moveDown': { before: '- o[]ne\n- two', after: '- two\n- one' },
  'outline.promote': { before: '## T[]itle', after: '# Title' },
  'outline.demote': { before: '## T[]itle', after: '### Title' },
  'outline.fold': { before: '## T[]itle\n\nBody', after: '## Title\n\nBody' },
  'outline.unfold': { before: '## T[]itle\n\nBody', after: '## Title\n\nBody' },
  'outline.showAll': { before: '## T[]itle\n\nBody', after: '## Title\n\nBody' },
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => [
      `outline.showLevel${level}`,
      { before: '## T[]itle\n\nBody', after: '## Title\n\nBody' },
    ]),
  ),
  'text.setColor': {
    before: 'one []two',
    after: '<span data-color="brick">one two</span>',
    args: { color: 'brick' },
    objects: true,
  },
};

/** WP4's commands: every PAGE_KEYS entry in its sections of PLAN.md section 3.10. */
const WP4 = (Object.keys(PAGE_KEYS) as PageCommandId[]).filter((id) =>
  /^(format|block|outline|insert\.(date|time|dateTime)$|text\.setColor$)/.test(id),
);

describe('WP4’s page commands', () => {
  // The first command loads the editor's chunk, which takes a while under load.
  beforeAll(async () => {
    await import('./commands');
    await open('warm up');
    await cleanupPages();
  }, 60_000);

  it('are all registered, each with a case', () => {
    const registered = WP4.filter((id) => commands.get(id));
    expect(WP4.filter((id) => !CASES[id])).toEqual([]);
    expect(registered).toEqual(WP4);
  });

  for (const [id, testCase] of Object.entries(CASES)) {
    it(`${id} changes the text as one undo step`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
      await expectCase(id, testCase);
    });
  }
});

describe('the formatting toggles', () => {
  it('report whether they are on, and announce the change', async () => {
    const { page } = await open('a **[b]** c');
    expect(commands.get('format.bold')?.checked?.({} as never)).toBe(true);
    expect(commands.get('format.italic')?.checked?.({} as never)).toBe(false);
    await executeCommand('format.bold');
    expect(commands.get('format.bold')?.checked?.({} as never)).toBe(false);
    expect(page.mounted.pool.active()).not.toBeNull();
  });

  it('do nothing in code, so their keys go on', async () => {
    await open('```\nco[d]e\n```');
    expect(commands.get('format.bold')?.enabled?.({ source: 'keyboard' } as never)).toBe(false);
  });
});

const SHIFTED: Record<string, [code: string, base: string]> = {
  '>': ['Period', '.'],
  '<': ['Comma', ','],
  '+': ['Equal', '='],
  _: ['Minus', '-'],
  '}': ['BracketRight', ']'],
  '{': ['BracketLeft', '['],
};
const PLAIN: Record<string, string> = {
  '.': 'Period',
  ',': 'Comma',
  '=': 'Equal',
  '-': 'Minus',
  '/': 'Slash',
  '\\': 'Backslash',
  ']': 'BracketRight',
  '[': 'BracketLeft',
};
const ARROWS: Record<string, string> = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' };
const US_SHIFTED_DIGITS = ')!@#$%^&*(';

/** The key and code a US keyboard reports for a chord's key, adding Shift where the key needs it. */
function usKey(key: string, mods: Set<string>): { key: string; code: string } {
  if (SHIFTED[key]) {
    mods.add('Shift');
    return { key, code: SHIFTED[key][0] };
  }
  if (PLAIN[key]) return { key, code: PLAIN[key] };
  if (/^[A-Z]$/.test(key)) return { key: mods.has('Shift') ? key : key.toLowerCase(), code: `Key${key}` };
  if (/^\d$/.test(key)) {
    return { key: mods.has('Shift') ? US_SHIFTED_DIGITS[Number(key)] : key, code: `Digit${key}` };
  }
  if (ARROWS[key]) return { key: ARROWS[key], code: ARROWS[key] };
  return { key, code: key };
}

/** A key press on a US keyboard for a chord in canonical form, aimed at `target`. */
function usPress(chord: string, target: Element) {
  const cut = chord.endsWith('++') ? chord.length - 1 : chord.lastIndexOf('+') + 1;
  const mods = new Set(
    chord
      .slice(0, Math.max(0, cut - 1))
      .split('+')
      .filter(Boolean),
  );
  const { key, code } = usKey(chord.slice(cut), mods);
  return {
    key,
    code,
    ctrlKey: mods.has('Ctrl'),
    altKey: mods.has('Alt'),
    shiftKey: mods.has('Shift'),
    metaKey: false,
    isComposing: false,
    repeat: false,
    getModifierState: () => false,
    target,
  };
}

/** Each chord of WP4's registered commands in a set, with the command it should reach. */
function keyed(set: 'keys' | 'oneNoteKeys'): (readonly [PageCommandId, string])[] {
  return WP4.filter((id) => commands.get(id)).flatMap((id) => {
    const spec = PAGE_KEYS[id] as { keys: readonly string[]; oneNoteKeys?: readonly string[] };
    const chords = set === 'keys' ? spec.keys : (spec.oneNoteKeys ?? spec.keys);
    return chords.map((chord) => [id, chord] as const);
  });
}

describe('the keys', () => {
  for (const preset of ['default', 'onenote'] as const) {
    it(`reach their commands from a text editor in the ${preset} set`, async () => {
      settingsStore.set({ settings: { ...DEFAULT_SETTINGS, keymap: { preset } }, readOnly: false });
      const { page, block } = await open('- [ ] [task]');
      const target = page.mounted.pool.editor(block)!.view.dom;
      const reached = keyed(preset === 'default' ? 'keys' : 'oneNoteKeys').map(([id, chord]) => [
        chord,
        commandForKey(usPress(chord, target))?.id ?? null,
        id,
      ]);
      expect(reached.filter(([, got, id]) => got !== id)).toEqual([]);
    });
  }

  it('let Ctrl+K open the palette at a bare caret outside a link', async () => {
    const { page, block } = await open('a []b');
    const target = page.mounted.pool.editor(block)!.view.dom;
    expect(commandForKey(usPress('Ctrl+K', target))?.id).not.toBe('format.link');
  });
});

describe('automatic changes', () => {
  // WP0's sync coalesces every transaction as typing. WP2's sync sends META_AUTO_CHANGE as its own step, and the
  // editor tests already check that each conversion is its own transaction with that meta.
  it.todo('undo in one step, leaving the typed characters, once WP2’s sync separates automatic changes');
});
