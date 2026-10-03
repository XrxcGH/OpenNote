// A page view for tests, over the memory page service (PLAN.md section 3.15, owned by WP0). It mounts the real
// page assembly without the shell, types with real key events in browser mode, and reads back what the service
// holds, so each package tests its feature end to end on the stubs from day one.
import { initFlags } from '../../../app/flags';
import type { FlagId } from '../../../app/flags';
import { configureCommands, executeCommand } from '../../../commands/registry';
import { createMarkdownCache, serializeTextBlock } from '../../../editor/markdown';
import { createWebPlatform } from '../../../platform/web';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { MemoryPageService, PageFixture } from '../../../services/pages/memory';
import type { BlockId, EditBatch, Edit, OpenPage } from '../../../services/pages/types';
import { createMemoryNotesService } from '../../../services/notes/memory';
import { setDensity, setSizeClass } from '../../../state/layout';
import type { Density, SizeClass } from '../../../state/layout';
import type { PageCommandId } from '../keys';
import { mountPage } from '../mount';
import type { MountedPage } from '../mount';
import type { PageViewportApi } from '../viewport/viewport';
import { md } from './builders';
import { textPageFixture } from './fixtures';

export interface PageHarness {
  readonly service: MemoryPageService;
  readonly page: OpenPage;
  readonly viewport: PageViewportApi;
  readonly mounted: MountedPage;
  editRoot(block: BlockId): HTMLElement;
  wrapper(block: BlockId): HTMLElement;
  /** Real key events in browser mode; editor transactions elsewhere. */
  type(block: BlockId, text: string): Promise<void>;
  sent(): readonly EditBatch[];
  /** Fake timers for WP2's 150 and 300 ms flushes. WP0's sync sends at once, so this only waits. */
  advance(ms: number): Promise<void>;
  /** What the service holds. */
  markdown(block: BlockId): string;
  destroy(): Promise<void>;
}

export interface RenderPageOptions {
  fixture: PageFixture;
  sizeClass?: SizeClass;
  theme?: 'light' | 'dark';
  density?: Density;
  screenReader?: boolean;
  flags?: Partial<Record<FlagId, boolean>>;
  oneNoteKeys?: boolean;
}

const LAYERS = { viewport: 'page-viewport', world: 'page-world', underlay: 'page-underlay' };
const shown: PageHarness[] = [];

async function realKeyboard(): Promise<((text: string) => Promise<void>) | null> {
  if (typeof navigator === 'undefined' || /jsdom/i.test(navigator.userAgent)) return null;
  try {
    const { userEvent } = await import('vitest/browser');
    return (text) => userEvent.keyboard(text.replace(/[{[]/g, (char) => char + char));
  } catch {
    return null;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function applyText(markdown: string, edit: Edit): string {
  if (edit.edit === 'setText') return edit.markdown;
  if (edit.edit !== 'spliceText') return markdown;
  const bytes = encoder.encode(markdown);
  const end = edit.at + encoder.encode(edit.del).length;
  return decoder.decode(bytes.subarray(0, edit.at)) + edit.ins + decoder.decode(bytes.subarray(end));
}

/** A block's Markdown as the service holds it: the fixture's, with every text edit sent since applied. */
function heldMarkdown(fixture: PageFixture, sent: readonly EditBatch[], block: BlockId): string {
  const initial = fixture.page.blocks.find((candidate) => candidate.id === block)?.data.markdown;
  let markdown = typeof initial === 'string' ? initial : '';
  for (const edit of sent.flatMap((batch) => batch.edits)) {
    if (edit.edit === 'insertBlock' && edit.block.id === block) markdown = String(edit.block.data.markdown ?? '');
    else if ('block' in edit && edit.block === block) markdown = applyText(markdown, edit);
  }
  return markdown;
}

/** Commands run against a web platform, as they do in the app. */
function configure(oneNoteKeys: boolean): void {
  const platform = createWebPlatform({ followBrowser: false });
  if (oneNoteKeys) void platform.settings.update({ keymap: { preset: 'onenote' } });
  configureCommands({ platform, notes: createMemoryNotesService({ seed: 'empty' }) });
}

export async function renderPage(options: RenderPageOptions): Promise<PageHarness> {
  initFlags('dev', { 'page.editor': true, ...options.flags });
  configure(options.oneNoteKeys ?? false);
  if (options.sizeClass) setSizeClass(options.sizeClass);
  if (options.density) setDensity(options.density);
  const service = createMemoryPageService([options.fixture]);
  const page = await service.open(options.fixture.page.id, { viewport: null });
  const container = document.body.appendChild(document.createElement('div'));
  container.dataset.scope = 'page';
  if (options.theme) container.dataset.theme = options.theme;
  const mounted = mountPage(container, page, {
    classNames: LAYERS,
    host: { screenReader: () => options.screenReader ?? false },
  });
  const view = (block: BlockId) => {
    const found = mounted.layer.view(block);
    if (!found) throw new Error(`The page shows no block ${block}.`);
    return found;
  };
  const harness: PageHarness = {
    service,
    page,
    viewport: mounted.viewport,
    mounted,
    editRoot: (block) => view(block).editRoot ?? view(block).element,
    wrapper: (block) => view(block).element,
    async type(block, text) {
      const editor = mounted.pool.mount(block, { kind: 'end' }, 'target');
      if (!editor) throw new Error(`Block ${block} has no editor.`);
      editor.commands.focus('end');
      const keyboard = await realKeyboard();
      if (keyboard) await keyboard(text);
      else for (const char of text) editor.commands.insertContent(char);
      await mounted.sync.flushAll('timer');
    },
    sent: () => service.sent(page.id),
    advance: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    markdown: (block) => heldMarkdown(options.fixture, service.sent(page.id), block),
    async destroy() {
      await mounted.destroy();
      container.remove();
      shown.splice(shown.indexOf(harness), 1);
    },
  };
  shown.push(harness);
  return harness;
}

/** Removes every page renderPage made. Call it in afterEach. */
export async function cleanupPages(): Promise<void> {
  await Promise.all([...shown].map((harness) => harness.destroy()));
}

/**
 * Runs a command on a text block that holds `before`, with its selection marked as in `md`, and expects the
 * block to hold `after`. With `sent: 'snapshot'`, the batches sent to the service are snapshotted too.
 */
export async function expectCommand(
  id: PageCommandId,
  before: string,
  after: string,
  options: { kind?: 'text' | 'table'; sent?: 'snapshot' } = {},
): Promise<void> {
  const { expect } = await import('vitest');
  const marked = md(before);
  const fixture = textPageFixture(serializeTextBlock(marked.doc, createMarkdownCache()));
  const block = fixture.page.blocks[0].id;
  const harness = await renderPage({ fixture });
  try {
    const editor = harness.mounted.pool.mount(
      block,
      { kind: 'selection', anchor: marked.anchor, head: marked.head },
      'target',
    );
    editor?.commands.focus();
    expect(await executeCommand(id), `${id} ran`).toBe(true);
    await harness.mounted.sync.flushAll('command');
    expect(harness.markdown(block)).toBe(after);
    if (options.sent === 'snapshot') expect(harness.sent()).toMatchSnapshot();
  } finally {
    await harness.destroy();
  }
}
