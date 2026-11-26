// How tools render in the command bar (docs/BRAND.md section 8): an icon before the name, icon-only formatting glyphs
// with a tooltip, a pressed tool that keeps its icon weight and shows an outline, and Undo in More.
// One page opens once, and each part of the bar is checked in turn. The formatting tools show only with the caret in
// the editor. The Draw tab waits for the ink tools to load. The editor does not open a second time in one file.

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { FLAGS } from '../../app/flags';
import { navigate } from '../../app/location';
import type { NodeId } from '../../services/notes/types';
import { renderApp, setViewport } from '../../test';

vi.setConfig({ testTimeout: 120_000 });

const mitosis = {
  view: 'workspace' as const,
  notebookId: 'n-biology' as NodeId,
  sectionId: 's-lectures' as NodeId,
  pageId: 'p-mitosis' as NodeId,
};

afterEach(async () => {
  await setViewport(1280, 800);
});

const bar = (name: string) => screen.getByRole('toolbar', { name });
const tool = (name: string, label: string) => within(bar(name)).getByRole('button', { name: label });
const svgs = (element: Element) => [...element.querySelectorAll('svg[aria-hidden]')];

/** The box-shadow of a tool: an inset 1 px ring when it is pressed. */
const ringOf = (element: Element) => getComputedStyle(element).boxShadow;

async function openPage() {
  await setViewport(2200, 900);
  const flagOverrides = Object.fromEntries(FLAGS.map((flag) => [flag.id, true]));
  await renderApp({ boot: { flagOverrides } });
  act(() => navigate(mitosis));
  await screen.findByRole('toolbar', { name: 'Home' });
  await vi.waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull(), { timeout: 30_000 });
  // The formatting tools show with the caret in the editor.
  await vi.waitFor(
    () => {
      (document.querySelector('.ProseMirror') as HTMLElement).focus();
      expect(within(bar('Home')).queryByRole('button', { name: 'Bold' })).not.toBeNull();
    },
    { timeout: 30_000 },
  );
  await screen.findByRole('tab', { name: 'Draw' }, { timeout: 40_000 });
}

async function showTab(name: string) {
  await userEvent.click(screen.getByRole('tab', { name }));
  return bar(name);
}

async function glyphs() {
  const bold = tool('Home', 'Bold');
  expect(svgs(bold)).toHaveLength(1);
  expect(bold.textContent).toBe('');
  expect(bold.getAttribute('aria-label')).toBe('Bold');
  await userEvent.hover(bold);
  expect((await screen.findByRole('tooltip')).textContent).toBe('Bold (Ctrl+B)');
  await userEvent.unhover(bold);

  // A pressed glyph tool keeps its Regular icon and gains the inset ring.
  const rest = svgs(bold)[0].innerHTML;
  expect(ringOf(bold)).toBe('none');
  bold.click();
  await waitFor(() => expect(bold.getAttribute('aria-pressed')).toBe('true'));
  expect(svgs(bold)[0].innerHTML).toBe(rest);
  expect(ringOf(bold)).toMatch(/0px 0px 0px 1px inset|inset 0px 0px 0px 1px/);
  bold.click();
  await waitFor(() => expect(bold.getAttribute('aria-pressed')).toBe('false'));

  // A touch hold shows the tooltip and runs nothing.
  const touch = (type: string) =>
    fireEvent(bold, new PointerEvent(type, { pointerType: 'touch', bubbles: true, clientX: 10, clientY: 10 }));
  touch('pointerdown');
  expect(screen.queryByRole('tooltip')).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect((await screen.findByRole('tooltip')).textContent).toBe('Bold (Ctrl+B)');
  // The long press ends in a context menu event, which a touch hold swallows and a mouse right-click does not.
  const held = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  bold.dispatchEvent(held);
  expect(held.defaultPrevented).toBe(true);
  touch('pointerup');
  bold.click();
  // The swallowed click runs nothing. Give a late update a few frames to show.
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(bold.getAttribute('aria-pressed')).toBe('false');
  await new Promise((resolve) => setTimeout(resolve, 700));
  const mouseMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  fireEvent(bold, new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
  bold.dispatchEvent(mouseMenu);
  expect(mouseMenu.defaultPrevented).toBe(false);
  fireEvent(bold, new PointerEvent('pointerup', { pointerType: 'mouse', bubbles: true }));

  // A touch press of 200 ms is a tap: Bold runs and no tooltip shows.
  touch('pointerdown');
  await new Promise((resolve) => setTimeout(resolve, 200));
  touch('pointerup');
  bold.click();
  await waitFor(() => expect(bold.getAttribute('aria-pressed')).toBe('true'));
  expect(screen.queryByRole('tooltip')).toBeNull();
  bold.click();
  await waitFor(() => expect(bold.getAttribute('aria-pressed')).toBe('false'));

  // Named tools show the icon and the name.
  const wide = tool('Home', 'New page');
  expect(svgs(wide)).toHaveLength(1);
  expect(wide.textContent).toContain('New page');
}

async function viewBar() {
  await showTab('View');
  const notebooks = await waitFor(() => tool('View', 'Notebooks pane'));
  expect(notebooks.getAttribute('aria-pressed')).toBe('true');
  await waitFor(() => expect(svgs(notebooks)).toHaveLength(1));
  const icon = svgs(notebooks)[0].innerHTML;
  expect(ringOf(notebooks)).toMatch(/1px/);
  const name = notebooks.querySelector('span > span') as HTMLElement;
  expect(getComputedStyle(name).fontWeight).toBe('600');
  const copy = notebooks.querySelector('span[aria-hidden="true"]:not([data-tool-icon])') as HTMLElement;
  expect(copy.textContent).toBe('Notebooks pane');
  expect(getComputedStyle(copy).visibility).toBe('hidden');
  expect(getComputedStyle(copy).fontWeight).toBe('600');
  const pressedWidth = notebooks.getBoundingClientRect().width;
  notebooks.click();
  await waitFor(() => expect(notebooks.getAttribute('aria-pressed')).toBe('false'));
  expect(ringOf(notebooks)).toBe('none');
  expect(svgs(notebooks)[0].innerHTML).toBe(icon);
  expect(Math.abs(notebooks.getBoundingClientRect().width - pressedWidth)).toBeLessThan(0.5);
}

async function drawBar() {
  // With every flag on, the Review tab shows too, so the Draw bar needs a little more room than 2200 px gives it.
  await setViewport(2400, 900);
  await showTab('Draw');
  const curve = await waitFor(() => tool('Draw', 'Make curve'));
  await waitFor(() => expect(svgs(curve)).toHaveLength(1));
  expect(svgs(await waitFor(() => tool('Draw', 'Shapes')))).toHaveLength(1);
  expect(svgs(tool('Draw', 'Add text to shape'))).toHaveLength(1);

  const toggle = tool('Draw', 'Ink to shape');
  await waitFor(() => expect(svgs(toggle)).toHaveLength(1));
  const before = svgs(toggle)[0].innerHTML;
  const pressed = toggle.getAttribute('aria-pressed') === 'true';
  toggle.click();
  await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe(String(!pressed)));
  expect(svgs(toggle)[0].innerHTML).toBe(before);
  expect(ringOf(toggle) !== 'none').toBe(!pressed);
}

/** Undo is in the title bar, so the command bar lists it under More at every size class, with its icon. */
async function undoInMore() {
  await showTab('Home');
  for (const width of [2200, 1280, 1024, 700]) {
    await setViewport(width, 900);
    await waitFor(() => expect(within(bar('Home')).getByRole('button', { name: 'More commands' })).toBeTruthy());
    expect(within(bar('Home')).queryByRole('button', { name: 'Undo' })).toBeNull();
    await userEvent.click(within(bar('Home')).getByRole('button', { name: 'More commands' }));
    const item = await screen.findByRole('menuitem', { name: /^Undo/ });
    expect(svgs(item)).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
  }
  // At Medium a named tool shows its name alone.
  await waitFor(() => expect(document.documentElement.dataset.sizeClass).toBe('medium'));
  const medium = tool('Home', 'New page');
  expect(svgs(medium)).toHaveLength(0);
  expect(medium.textContent).toContain('New page');
}

it('draws icons on the Home, View and Draw bars, keeps pressed tools Regular, and lists Undo in More', async () => {
  await openPage();
  await glyphs();
  await viewBar();
  await drawBar();
  await undoInMore();
});
