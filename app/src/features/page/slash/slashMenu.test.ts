// @vitest-environment jsdom
// The slash menu on a real page. "/" at the start of a line opens a listbox the editor controls, the filter
// narrows it, and arrows move the highlight with an announcement. Enter removes the "/" and the filter, then runs
// the item. Escape closes it and keeps the text, and "/" in the middle of a line or in code is just a slash.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../registrations/editor';
import { typeInto } from '../../../editor/commands/testing';
import { clearAnnouncements, announcements } from '../../../ui/announce';
import { textPageFixture } from '../test/fixtures';
import { cleanupPages, renderPage } from '../test/harness';
import { slashMatches } from './slashMenu';

afterEach(async () => {
  await cleanupPages();
  clearAnnouncements();
});

beforeAll(async () => {
  await import('./slashMenu');
  await import('../formattingBar/commands');
}, 60_000);

async function open(markdown = '') {
  const fixture = textPageFixture(markdown);
  const block = fixture.page.blocks[0].id;
  const page = await renderPage({ fixture });
  const editor = page.mounted.pool.mount(block, { kind: 'end' }, 'target')!;
  editor.commands.focus('end', { scrollIntoView: false });
  return { page, block, editor };
}

const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]');
const options = () =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.textContent);

function press(editor: Awaited<ReturnType<typeof open>>['editor'], key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event)) ?? false;
}

describe('the slash menu', () => {
  it('lists the basic blocks, with headings 4 to 6 only on request', () => {
    expect(slashMatches('').map((item) => item.id)).not.toContain('editor.heading4');
    expect(slashMatches('heading').map((item) => item.id)).toEqual([
      'editor.heading1',
      'editor.heading2',
      'editor.heading3',
      'editor.heading4',
      'editor.heading5',
      'editor.heading6',
    ]);
    expect(slashMatches('todo').map((item) => item.id)).toEqual(['editor.checklist']);
  });

  it('opens on "/" at the start of a line, controlled by the editor', async () => {
    const { editor } = await open();
    typeInto(editor, '/');
    await vi.waitFor(() => expect(listbox()).not.toBeNull());
    expect(editor.view.dom.getAttribute('aria-controls')).toBe(listbox()!.id);
    expect(editor.view.dom.getAttribute('aria-haspopup')).toBe('listbox');
    expect(editor.view.dom.getAttribute('aria-activedescendant')).toBe(listbox()!.querySelector('[role="option"]')!.id);
  });

  it('filters as you type, announces the highlight, and runs the chosen item', async () => {
    const { page, block, editor } = await open();
    typeInto(editor, '/');
    await vi.waitFor(() => expect(listbox()).not.toBeNull());
    typeInto(editor, 'head');
    expect(options()).toEqual(['Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6']);
    expect(press(editor, 'ArrowDown')).toBe(true);
    expect(announcements().at(-1)).toBe('Heading 2, 2 of 6.');
    expect(press(editor, 'Enter')).toBe(true);
    expect(listbox()).toBeNull();
    typeInto(editor, 'Title');
    await vi.waitFor(() => expect(editor.state.doc.firstChild?.type.name).toBe('heading'));
    await page.mounted.sync.flushAll('command');
    expect(page.markdown(block)).toBe('## Title');
  });

  it('closes on Escape and keeps the text', async () => {
    const { editor } = await open();
    typeInto(editor, '/');
    await vi.waitFor(() => expect(listbox()).not.toBeNull());
    typeInto(editor, 'x');
    expect(press(editor, 'Escape')).toBe(true);
    expect(listbox()).toBeNull();
    expect(editor.state.doc.textContent).toBe('/x');
    expect(editor.view.dom.hasAttribute('aria-haspopup')).toBe(false);
  });

  it('stays closed in the middle of a line and in code', async () => {
    const { editor } = await open('a');
    typeInto(editor, '/');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listbox()).toBeNull();
    await cleanupPages();
    const code = await open('```\n\n```');
    code.editor.commands.focus('start', { scrollIntoView: false });
    typeInto(code.editor, '/');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listbox()).toBeNull();
  });
});
