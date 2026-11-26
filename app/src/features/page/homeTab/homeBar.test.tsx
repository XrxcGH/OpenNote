// The Home tab in a real browser (text:home-tab-ui, B10).
// The bar's tools run their commands. Narrow bars move tools into More in priority order.
// A half-bold selection shows aria-pressed mixed. A pen selection opens the two-row mini toolbar.
// The Aa sheet has 44 px targets. Axe finds nothing on the tab or its open menus.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { FLAGS } from '../../../app/flags';
import { navigate } from '../../../app/location';
import { mountEditor } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import { commandBar } from '../../../registries';
import type { CommandBarComponentProps } from '../../../registries/types';
import { expectNoAxeViolations, renderApp, setViewport } from '../../../test';
import { closeFormattingBar } from '../formattingBar/bar';
import { shownPool } from '../pool/shown';
import { MenuTool } from './components';
import { StylesGallery } from './StylesGallery';
import '../registrations/editor';

let current: Editor | null = null;
// The editor mounts outside the page, so a stand-in pool hands it to the Home tab as the active text block.
const fakePool = {
  active: () => (current ? { block: 'b1', editor: current } : null),
  editor: () => current,
  onActiveChange: () => () => undefined,
};

let mounted: TestEditor | null = null;
let stopKeeping: () => void = () => undefined;
const mitosis = {
  view: 'workspace' as const,
  notebookId: 'n-biology' as never,
  sectionId: 's-lectures' as never,
  pageId: 'p-mitosis' as never,
};

function edit(source: string): Editor {
  mounted?.destroy();
  mounted = mountEditor(source);
  current = mounted.editor;
  mounted.editor.view.dom.setAttribute('data-scope', 'editor');
  return mounted.editor;
}

async function openHome(width = 1280) {
  const flagOverrides = Object.fromEntries(FLAGS.map((flag) => [flag.id, true]));
  await renderApp({ boot: { flagOverrides } });
  await setViewport(width, 800);
  act(() => navigate(mitosis));
  // The page puts its own pool there as it shows; the stand-in stays the active one.
  const keep = () => void (shownPool.get() !== (fakePool as never) && shownPool.set(fakePool as never));
  stopKeeping = shownPool.subscribe(keep);
  keep();
  return screen.findByRole('toolbar', { name: 'Home' });
}

beforeAll(() => {
  edit('abcd');
});

afterEach(async () => {
  stopKeeping();
  shownPool.set(null);
  closeFormattingBar();
  document.querySelector('[data-compact-sheet-host]')?.remove();
  await setViewport(1280, 800);
});

const homeIds = () => toolIds(screen.getByRole('toolbar', { name: 'Home' }));
const toolIds = (toolbar: HTMLElement) =>
  [...toolbar.querySelectorAll<HTMLElement>('[data-item-id]')].map((slot) => slot.dataset.itemId as string);

describe('the Home tab', () => {
  it('shows the version 2 controls and none of the tools they replace', async () => {
    edit('abcd');
    await openHome(1920);
    await waitFor(() => expect(homeIds()).toContain('home.underline'), { timeout: 10_000 });
    const ids = homeIds();
    expect(ids).toContain('home.font');
    expect(ids).toContain('home.size');
    expect(ids).not.toContain('editor.format.underline');
    expect(ids).not.toContain('editor.format.highlight');
  });

  it('moves tools into More in priority order as the bar narrows', async () => {
    edit('abcd');
    await openHome(1920);
    await waitFor(() => expect(homeIds()).toContain('home.underline'), { timeout: 10_000 });
    const wide = homeIds();
    const priority = new Map(commandBar.list().map((item) => [item.id, item.priority]));
    await setViewport(900, 800);
    await waitFor(() => expect(homeIds().length).toBeLessThan(wide.length), { timeout: 10_000 });
    const shown = new Set(homeIds());
    const narrow = screen.getByRole('toolbar', { name: 'Home' });
    const hidden = wide.filter((id) => !shown.has(id));
    expect(hidden.length).toBeGreaterThan(0);
    const byPriority = (ids: readonly string[]) =>
      ids.map((id) => priority.get(id)).filter((p): p is number => p !== undefined);
    const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(byPriority(hidden))).toBeLessThan(mean(byPriority([...shown])));
    // The five tools with the lowest priority are the first to go.
    const lowest = [...wide].sort((a, b) => (priority.get(a) ?? 0) - (priority.get(b) ?? 0)).slice(0, 5);
    expect(lowest.filter((id) => shown.has(id))).toEqual([]);
    await userEvent.click(within(narrow).getByRole('button', { name: 'More commands' }));
    expect(await screen.findAllByRole('menuitem')).not.toHaveLength(0);
  });

  it('Bold on half the selection shows aria-pressed mixed', async () => {
    const editor = edit('abcd');
    await openHome(1920);
    editor.commands.setTextSelection({ from: 1, to: 3 });
    editor.chain().toggleMark('bold').run();
    editor.commands.selectAll();
    act(() => void document.dispatchEvent(new Event('selectionchange')));
    const bold = () => within(screen.getByRole('toolbar', { name: 'Home' })).getByRole('button', { name: 'Bold' });
    await waitFor(() => expect(bold().getAttribute('aria-pressed')).toBe('mixed'));
    editor.commands.setTextSelection({ from: 1, to: 3 });
    act(() => void document.dispatchEvent(new Event('selectionchange')));
    await waitFor(() => expect(bold().getAttribute('aria-pressed')).toBe('true'));
  });

  it('the underline split button runs Underline and its caret lists the styles', async () => {
    const editor = edit('abcd');
    const toolbar = await openHome(1920);
    editor.commands.setTextSelection({ from: 1, to: 3 });
    await waitFor(() => expect(homeIds()).toContain('home.underline'), { timeout: 10_000 });
    const group = await within(toolbar).findByRole('group', { name: 'Underline' }, { timeout: 15_000 });
    await userEvent.click(within(group).getByRole('button', { name: 'Underline' }));
    await waitFor(() => expect(editor.getHTML()).toBe('<p><u>ab</u>cd</p>'), { timeout: 10_000 });
    await userEvent.click(within(group).getByRole('button', { name: 'Underline options' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThanOrEqual(10);
    await expectNoAxeViolations(menu);
  });

  it('passes axe on the Home tab', async () => {
    edit('abcd');
    const toolbar = await openHome(1920);
    await waitFor(() => expect(toolIds(toolbar)).toContain('home.font'));
    await expectNoAxeViolations(toolbar);
  });
});

describe('the Home tab controls', () => {
  it('every menu tool opens a menu with items, and Shading and Borders are named for what they open', async () => {
    edit('abcd');
    const cases = [
      ['list.multilevel', 'Multilevel list'],
      ['para.lineSpacing', 'Line spacing'],
      ['para.shade', 'Shading'],
      ['para.border', 'Borders'],
      ['format.changeCase', 'Change case'],
      ['format.effect', 'Text effects'],
    ] as const;
    for (const [command, label] of cases) {
      const view = render(<MenuTool toolProps={{ tabIndex: -1, 'data-tool': '' }} command={command} label={label} />);
      await userEvent.click(view.getByRole('button', { name: label }));
      const menu = await screen.findByRole('menu', {}, { timeout: 5000 });
      expect(within(menu).getAllByRole('menuitem').length, command).toBeGreaterThan(1);
      await userEvent.click(within(menu).getAllByRole('menuitem')[0]);
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      view.unmount();
    }
    for (const [id, name] of [
      ['home.shade', 'Shading'],
      ['home.border', 'Borders'],
    ] as const) {
      const Registered = commandBar.list().find((item) => item.id === id)
        ?.Component as ComponentType<CommandBarComponentProps>;
      const view = render(<Registered toolProps={{ tabIndex: -1, 'data-tool': '' }} />);
      expect(await view.findByRole('button', { name })).toBeTruthy();
      view.unmount();
    }
  });

  it('the gallery tiles are in the arrow-key set of the toolbar, not extra Tab stops', async () => {
    edit('abcd');
    const view = render(<StylesGallery toolProps={{ tabIndex: -1, 'data-tool': '' }} />);
    const tiles = [...view.container.querySelectorAll<HTMLElement>('button')];
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) expect(tile.hasAttribute('data-tool')).toBe(true);
    view.unmount();
    const toolbar = await openHome(1920);
    await waitFor(() => expect(toolIds(toolbar)).toContain('home.font'), { timeout: 10_000 });
    const stops = [...toolbar.querySelectorAll<HTMLElement>('button')].filter((button) => button.tabIndex === 0);
    expect(stops).toHaveLength(1);
  });
});

describe('the mini toolbar and the Aa sheet', () => {
  it('has two rows after a pen selection', async () => {
    const editor = edit('abcd');
    await openHome();
    editor.commands.focus();
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'pen', bubbles: true }));
    editor.commands.setTextSelection({ from: 1, to: 4 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.dispatchEvent(new Event('selectionchange'));
    const bar = await screen.findByRole('toolbar', { name: 'Formatting' }, { timeout: 5000 });
    const rows = within(bar).getAllByRole('group');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Font and style', 'Formatting']);
    expect(within(rows[1]).getByRole('button', { name: 'Bold' })).toBeTruthy();
    expect(within(rows[0]).getByRole('button', { name: 'Grow font' })).toBeTruthy();
    await expectNoAxeViolations(bar);
  });

  it('the mini toolbar has one Tab stop', async () => {
    const editor = edit('abcd');
    await openHome();
    editor.commands.focus();
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'pen', bubbles: true }));
    editor.commands.setTextSelection({ from: 1, to: 4 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.dispatchEvent(new Event('selectionchange'));
    const bar = await screen.findByRole('toolbar', { name: 'Formatting' }, { timeout: 5000 });
    expect([...bar.querySelectorAll('button')].filter((button) => button.tabIndex === 0)).toHaveLength(1);
  });

  it('the Aa sheet takes focus, closes on Escape, and gives focus back', async () => {
    edit('abcd');
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { toggleCompactSheet } = await import('./CompactSheet');
    toggleCompactSheet();
    const sheet = await screen.findByRole('dialog', { name: 'Text formatting' });
    // Focus is on the sheet, never on a text box, so a phone's keyboard does not open over it.
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Text formatting' })).toBeNull());
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('the Aa sheet has targets of at least 44 px', async () => {
    edit('abcd');
    const { toggleCompactSheet } = await import('./CompactSheet');
    toggleCompactSheet();
    const sheet = await screen.findByRole('dialog', { name: 'Text formatting' });
    const buttons = [...sheet.querySelectorAll('button')].filter((button) => !button.closest('[role="listbox"]'));
    expect(buttons.length).toBeGreaterThan(10);
    const small = buttons
      .map((button) => ({ name: button.textContent, box: button.getBoundingClientRect() }))
      .filter(({ box }) => box.width < 44 || box.height < 44);
    expect(small).toEqual([]);
    await expectNoAxeViolations(sheet);
  });
});
