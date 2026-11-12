// The Home tab's controls in a real browser (text:home-tab-ui, B10, gap G11).
// One row per control: click it, or commit its box, and the command that ran has the right id and arguments.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { FLAGS } from '../../../app/flags';
import { navigate } from '../../../app/location';
import { mountEditor } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import { commandBar, commands } from '../../../registries';
import { t } from '../../../strings/t';
import { renderApp, setViewport } from '../../../test';
import { closeFormattingBar } from '../formattingBar/bar';
import { shownPool } from '../pool/shown';
import { MenuTool } from './components';
import { StylesGallery } from './StylesGallery';
import '../registrations/editor';

let mounted: TestEditor | null = null;
let current: Editor | null = null;
const fakePool = {
  active: () => (current ? { block: 'b1', editor: current } : null),
  editor: () => current,
  onActiveChange: () => () => undefined,
};
const mitosis = {
  view: 'workspace' as const,
  notebookId: 'n-biology' as never,
  sectionId: 's-lectures' as never,
  pageId: 'p-mitosis' as never,
};

type Call = [string, unknown];
const calls: Call[] = [];
const restore: (() => void)[] = [];
let stopKeeping: () => void = () => undefined;

/** Records every command the bar runs, with its arguments, then runs the real one. */
function spyOnCommands(): void {
  for (const def of commands.list()) {
    const original = def.run;
    def.run = ((ctx: never, args: unknown) => {
      calls.push([def.id, args]);
      return (original as (c: never, a: unknown) => unknown)(ctx, args);
    }) as typeof def.run;
    restore.push(() => void (def.run = original));
  }
}

async function open(source: string): Promise<{ editor: Editor; toolbar: HTMLElement }> {
  mounted?.destroy();
  mounted = mountEditor(source);
  current = mounted.editor;
  mounted.editor.view.dom.setAttribute('data-scope', 'editor');
  const flagOverrides = Object.fromEntries(FLAGS.map((flag) => [flag.id, true]));
  await renderApp({ boot: { flagOverrides } });
  await setViewport(1920, 800);
  act(() => navigate(mitosis));
  const keep = () => void (shownPool.get() !== (fakePool as never) && shownPool.set(fakePool as never));
  stopKeeping = shownPool.subscribe(keep);
  keep();
  const toolbar = await screen.findByRole('toolbar', { name: 'Home' });
  await waitFor(() => expect(toolbar.querySelector('[data-item-id="home.underline"]')).not.toBeNull(), {
    timeout: 15_000,
  });
  spyOnCommands();
  mounted.editor.commands.setTextSelection({ from: 1, to: 3 });
  act(() => void document.dispatchEvent(new Event('selectionchange')));
  return { editor: mounted.editor, toolbar };
}

afterEach(async () => {
  stopKeeping();
  shownPool.set(null);
  closeFormattingBar();
  while (restore.length > 0) restore.pop()?.();
  calls.length = 0;
  await setViewport(1280, 800);
});

/** Clicks a control by its name. A control the narrow bar moved into More is clicked there, as a person would. */
async function press(toolbar: HTMLElement, name: string): Promise<void> {
  const found = within(toolbar).queryByRole('button', { name });
  if (found) {
    await userEvent.click(found);
    return;
  }
  await userEvent.click(within(toolbar).getByRole('button', { name: 'More commands' }));
  const menu = await screen.findByRole('menu');
  await userEvent.click(within(menu).getByRole('menuitem', { name }));
}
const ran = () => calls.map(([name]) => name);

describe('the Home tab controls run their commands', () => {
  const PLAIN: readonly (readonly [string, string])[] = [
    ['Bold', 'format.bold'],
    ['Italic', 'format.italic'],
    ['Grow font', 'format.growFont'],
    ['Shrink font', 'format.shrinkFont'],
    ['Format painter', 'format.painter'],
    ['Align left', 'para.alignStart'],
    ['Center', 'para.alignCenter'],
    ['Align right', 'para.alignEnd'],
    ['Justify', 'para.justify'],
    ['Increase indent', 'para.indent'],
    ['Decrease indent', 'para.outdent'],
  ];
  it.each(PLAIN)('%s runs %s', async (label, id) => {
    const { toolbar } = await open('abcd');
    await press(toolbar, label);
    await waitFor(() => expect(ran()).toContain(id));
  });

  it('the main buttons of the split tools apply the current choice', async () => {
    const { toolbar } = await open('abcd');
    await press(toolbar, t('editor.commands.highlight'));
    await waitFor(() => expect(calls).toContainEqual(['format.highlight', { color: null }]));
    await press(toolbar, t('textHome.textColor'));
    await waitFor(() => expect(calls).toContainEqual(['format.textColor', { color: 'theme:accent1' }]));
    await press(toolbar, t('editor.commands.bulletList'));
    await waitFor(() => expect(ran()).toContain('block.bulletList'));
    await press(toolbar, t('editor.commands.orderedList'));
    await waitFor(() => expect(ran()).toContain('block.orderedList'));
  });

  it('the size box commits its number as format.fontSize', async () => {
    const { toolbar } = await open('abcd');
    const box = within(toolbar).getByRole('combobox', { name: t('textFonts.sizeLabel') });
    await userEvent.clear(box);
    await userEvent.type(box, '18{Enter}');
    await waitFor(() => expect(calls).toContainEqual(['format.fontSize', { value: 18 }]));
  });

  it('the font box commits a name as format.font', async () => {
    const { toolbar } = await open('abcd');
    const box = within(toolbar).getByRole('combobox', { name: t('textFonts.pickerLabel') });
    await userEvent.clear(box);
    await userEvent.type(box, 'Georgia{Enter}');
    await waitFor(() => expect(calls.find(([name]) => name === 'format.font')?.[1]).toEqual({ value: 'Georgia' }));
  });

  it('a style tile applies its style to the paragraph', async () => {
    const { editor } = await open('abcd');
    const view = render(<StylesGallery toolProps={{ tabIndex: -1, 'data-tool': '' }} />);
    const tile = view.container.querySelector<HTMLElement>('[data-style="h1"]');
    expect(tile).not.toBeNull();
    await userEvent.click(tile as HTMLElement);
    await waitFor(() => expect(editor.getHTML()).toMatch(/^<h1/));
    view.unmount();
  });

  it('the Select menu runs Select similar formatting and Select all', async () => {
    const { editor } = await open('abcd');
    const props = { toolProps: { tabIndex: -1, 'data-tool': '' } as const, command: 'text.select' as const };
    const view = render(<MenuTool {...props} label={t('textHome.select.label')} />);
    act(() => view.getByRole('button', { name: t('textHome.select.label') }).click());
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByRole('menuitem', { name: t('textHome.select.similar') }));
    await waitFor(() => expect(ran()).toContain('format.selectSimilar'));
    act(() => view.getByRole('button', { name: t('textHome.select.label') }).click());
    const again = await screen.findByRole('menu');
    await userEvent.click(within(again).getByRole('menuitem', { name: t('textHome.select.all') }));
    await waitFor(() => expect(editor.state.selection.to - editor.state.selection.from).toBeGreaterThanOrEqual(4));
    view.unmount();
  });

  it('Select and Replace are registered in the Find group of the Home tab', () => {
    const find = commandBar.list().filter((item) => item.tab === 'home' && item.group === 'find');
    const byId = new Map(find.map((item) => [item.id, item.command]));
    expect(byId.get('home.select')).toBe('text.select');
    expect(byId.get('home.replace')).toBe('page.replace');
  });
});
