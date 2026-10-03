import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLayerEscape, layerStore } from '../state/layers';
import { expectFocus, expectNoAxeViolations, pressChord, renderUi } from '../test';
import { openMenu } from './Menu';
import type { MenuAnchor, MenuItemSpec } from './Menu';

/** Waits for opening motion to end, so axe measures final colors. */
const settle = () => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null)));

let stopEscape = () => {};
beforeEach(() => {
  stopEscape = installLayerEscape();
});
afterEach(() => stopEscape());

const colors: MenuItemSpec[] = [
  { id: 'ink', label: 'Ink', kind: 'radio', checked: true },
  { id: 'fern', label: 'Fern', kind: 'radio' },
];

function rowItems(onSelect = vi.fn()): MenuItemSpec[] {
  return [
    { id: 'new', label: 'New page', shortcut: 'Ctrl+N', onSelect },
    { id: 'rename', label: 'Rename', shortcut: 'F2', onSelect },
    { id: 'color', label: 'Color', submenu: colors },
    { id: 'up', label: 'Move up', disabled: true, onSelect },
    { id: 'down', label: 'Move down', onSelect },
    { id: 'delete', label: 'Delete', danger: true, separatorBefore: true, onSelect },
  ];
}

interface OpenOptions {
  items?: MenuItemSpec[];
  anchor?: MenuAnchor;
  theme?: 'light' | 'dark';
  density?: 'mouse' | 'touch';
}

async function open(options: OpenOptions = {}) {
  renderUi(<button type="button">Biology 101</button>, { theme: options.theme, density: options.density });
  const opener = screen.getByRole('button', { name: 'Biology 101' });
  opener.focus();
  const choice = openMenu({
    label: 'Notebook actions',
    items: options.items ?? rowItems(),
    anchor: options.anchor ?? opener,
  });
  const menu = await screen.findByRole('menu', { name: 'Notebook actions' });
  return { opener, choice, menu };
}

const item = (name: string) => screen.getByRole('menuitem', { name });

describe('menu rendering', () => {
  it('shows each item with its role, state, and shortcut', async () => {
    const { menu } = await open();
    expect(menu.getAttribute('popover')).toBe('manual');
    expect(menu.matches(':popover-open')).toBe(true);
    expect(item('Rename').getAttribute('aria-keyshortcuts')).toBe('F2');
    expect(item('New page').getAttribute('aria-keyshortcuts')).toBe('Control+N');
    expect(item('Move up').getAttribute('aria-disabled')).toBe('true');
    expect(item('Color').getAttribute('aria-haspopup')).toBe('menu');
    expect(item('Color').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  it('marks checkbox and radio items with aria-checked', async () => {
    await open({
      items: [
        { id: 'a', label: 'Show pages', kind: 'checkbox', checked: true },
        { id: 'b', label: 'Light', kind: 'radio', checked: false },
      ],
    });
    expect(screen.getByRole('menuitemcheckbox', { name: 'Show pages' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Light' }).getAttribute('aria-checked')).toBe('false');
  });

  it('resolves null at once for an empty menu', async () => {
    await expect(openMenu({ label: 'Nothing', items: [], anchor: { x: 0, y: 0 } })).resolves.toBeNull();
  });

  it('uses 44 px items with touch density', async () => {
    await open({ density: 'touch' });
    expect(item('Rename').getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`passes axe in the ${theme} theme, with a submenu open`, async () => {
      const { menu } = await open({ theme });
      await expectFocus(item('New page'));
      await pressChord('Down');
      await pressChord('Down');
      await pressChord('Right');
      await screen.findByRole('menu', { name: 'Color' });
      await settle();
      await expectNoAxeViolations(menu.parentElement ?? document.body);
    });
  }
});

describe('menu keyboard: moving', () => {
  it('focuses the first item, and Up and Down move with wrapping over disabled items', async () => {
    await open();
    await expectFocus(item('New page'));
    await pressChord('Up');
    await expectFocus(item('Delete'));
    await pressChord('Down');
    await expectFocus(item('New page'));
    await pressChord('End');
    await pressChord('Up');
    await pressChord('Up');
    await expectFocus(item('Move up'));
    await pressChord('Home');
    await expectFocus(item('New page'));
  });

  it('picks by type-ahead', async () => {
    await open();
    await userEvent.keyboard('m');
    await expectFocus(item('Move up'));
    await userEvent.keyboard('m');
    await expectFocus(item('Move down'));
  });
});

describe('menu keyboard: choosing', () => {
  it('runs the item with Enter after focus returns, and resolves with its id', async () => {
    let focusedWhenRun: Element | null = null;
    const onSelect = vi.fn(() => (focusedWhenRun = document.activeElement));
    const { opener, choice } = await open({ items: rowItems(onSelect) });
    await pressChord('Down');
    await pressChord('Enter');
    await expect(choice).resolves.toBe('rename');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(focusedWhenRun).toBe(opener);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs the item with Space, but never a disabled one', async () => {
    const onSelect = vi.fn();
    const { choice } = await open({ items: rowItems(onSelect) });
    await pressChord('End');
    await pressChord('Up');
    await pressChord('Up');
    await pressChord('Space');
    expect(onSelect).not.toHaveBeenCalled();
    await pressChord('Down');
    await pressChord('Space');
    await expect(choice).resolves.toBe('down');
  });

  it('closes with Escape and returns focus to the opener', async () => {
    const { opener, choice } = await open();
    await pressChord('Escape');
    await expect(choice).resolves.toBeNull();
    await expectFocus(opener);
    expect(layerStore.get()).toEqual([]);
  });

  it('closes with Tab', async () => {
    const { opener, choice } = await open();
    await pressChord('Tab');
    await expect(choice).resolves.toBeNull();
    await expectFocus(opener);
  });
});

describe('menu keyboard: submenus', () => {
  it('opens a submenu with Right, closes it with Left, and Escape closes only the submenu', async () => {
    const { choice } = await open();
    await pressChord('Down');
    await pressChord('Down');
    await pressChord('Right');
    await screen.findByRole('menu', { name: 'Color' });
    await expectFocus(screen.getByRole('menuitemradio', { name: 'Ink' }));
    expect(item('Color').getAttribute('aria-expanded')).toBe('true');
    await pressChord('Left');
    await expectFocus(item('Color'));
    expect(screen.queryByRole('menu', { name: 'Color' })).toBeNull();

    await pressChord('Enter');
    await screen.findByRole('menu', { name: 'Color' });
    await pressChord('Escape');
    await expectFocus(item('Color'));
    expect(screen.getByRole('menu', { name: 'Notebook actions' })).toBeTruthy();
    await pressChord('Right');
    await pressChord('Down');
    await pressChord('Enter');
    await expect(choice).resolves.toBe('fern');
  });
});

describe('menu pointer', () => {
  it('runs the clicked item', async () => {
    const { choice } = await open();
    fireEvent.click(item('Move down'));
    await expect(choice).resolves.toBe('down');
  });

  it('ignores clicks on disabled items', async () => {
    const onSelect = vi.fn();
    await open({ items: rowItems(onSelect) });
    fireEvent.click(item('Move up'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on a press outside it and returns focus', async () => {
    const { opener, choice } = await open();
    fireEvent.pointerDown(document.body);
    await expect(choice).resolves.toBeNull();
    await expectFocus(opener);
  });

  it('follows the pointer and opens a submenu when it rests on its item', async () => {
    await open();
    await userEvent.hover(item('Color'));
    await expectFocus(item('Color'));
    await screen.findByRole('menu', { name: 'Color' });
    await userEvent.hover(item('Rename'));
    await expect.poll(() => screen.queryByRole('menu', { name: 'Color' })).toBeNull();
  });

  it('opens at a point and stays inside the window', async () => {
    await open({ anchor: { x: window.innerWidth - 4, y: window.innerHeight - 4 } });
    const rect = screen.getByRole('menu').getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
  });

  it('opens below an element anchor', async () => {
    const { opener, menu } = await open();
    await expect
      .poll(() => menu.getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(opener.getBoundingClientRect().bottom - 1);
  });
});
