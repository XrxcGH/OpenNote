// How tools render in the command bar (docs/BRAND.md section 8): an icon before the name, icon-only formatting glyphs
// with a tooltip, a pressed tool that keeps its icon weight and shows an outline, and Undo in More.
// Each test opens a page once, because the formatting tools show only with the caret in the editor and the Draw tab
// waits for the ink tools to load.

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { FLAGS } from '../../app/flags';
import { navigate } from '../../app/location';
import { defineCommand } from '../../commands/registry';
import { commandBar, commands } from '../../registries';
import type { NodeId } from '../../services/notes/types';
import { disposeApp, renderApp, setViewport } from '../../test';

vi.setConfig({ testTimeout: 90_000 });

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

async function openPage(options: { draw?: boolean } = {}) {
  await setViewport(2200, 900);
  const flagOverrides = Object.fromEntries(FLAGS.map((flag) => [flag.id, true]));
  await renderApp({ boot: { flagOverrides } });
  act(() => navigate(mitosis));
  await screen.findByRole('toolbar', { name: 'Home' });
  await vi.waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull(), { timeout: 20_000 });
  // The formatting tools show with the caret in the editor.
  await vi.waitFor(
    () => {
      (document.querySelector('.ProseMirror') as HTMLElement).focus();
      expect(within(bar('Home')).queryByRole('button', { name: 'Bold' })).not.toBeNull();
    },
    { timeout: 20_000 },
  );
  if (options.draw) await screen.findByRole('tab', { name: 'Draw' }, { timeout: 30_000 });
}

async function showTab(name: string) {
  await userEvent.click(screen.getByRole('tab', { name }));
  return bar(name);
}

describe('the Home bar', () => {
  it('draws the formatting glyphs as icons, keeps a pressed one Regular with an outline, and lists Undo in More', async () => {
    await openPage();
    const bold = tool('Home', 'Bold');
    expect(svgs(bold)).toHaveLength(1);
    expect(bold.textContent).toBe('');
    expect(bold.getAttribute('aria-label')).toBe('Bold');
    await userEvent.hover(bold);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Bold (Ctrl+B)');
    await userEvent.unhover(bold);

    const rest = svgs(bold)[0].innerHTML;
    expect(ringOf(bold)).toBe('none');
    bold.click();
    await waitFor(() => expect(bold.getAttribute('aria-pressed')).toBe('true'));
    expect(svgs(bold)[0].innerHTML).toBe(rest);
    expect(ringOf(bold)).toMatch(/0px 0px 0px 1px inset|inset 0px 0px 0px 1px/);
    bold.click();

    // Named tools: icon and name at Wide and Expanded, name alone at Medium.
    const wide = tool('Home', 'New page');
    expect(svgs(wide)).toHaveLength(1);
    expect(wide.textContent).toContain('New page');

    // Undo is in the title bar, so the command bar lists it under More at every size class.
    for (const width of [2200, 1280, 1024, 700]) {
      await setViewport(width, 900);
      await waitFor(() => expect(within(bar('Home')).getByRole('button', { name: 'More commands' })).toBeTruthy());
      expect(within(bar('Home')).queryByRole('button', { name: 'Undo' })).toBeNull();
      await userEvent.click(within(bar('Home')).getByRole('button', { name: 'More commands' }));
      const item = await screen.findByRole('menuitem', { name: /^Undo/ });
      expect(svgs(item)).toHaveLength(1);
      await userEvent.keyboard('{Escape}');
    }
    await waitFor(() => expect(document.documentElement.dataset.sizeClass).toBe('medium'));
    const medium = tool('Home', 'New page');
    expect(svgs(medium)).toHaveLength(0);
    expect(medium.textContent).toContain('New page');
  });

  it('shows the tooltip on a 500 ms touch hold without running Bold, and runs Bold on a quick press', async () => {
    await openPage();
    const bold = tool('Home', 'Bold');
    const touch = (type: string) =>
      fireEvent(bold, new PointerEvent(type, { pointerType: 'touch', bubbles: true, clientX: 10, clientY: 10 }));
    touch('pointerdown');
    expect(screen.queryByRole('tooltip')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await screen.findByRole('tooltip')).textContent).toBe('Bold (Ctrl+B)');
    touch('pointerup');
    bold.click();
    expect(bold.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the View bar', () => {
  it('keeps the Regular icon on pressed Notebooks, with the ring, a semibold name and a steady width', async () => {
    await openPage();
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
  });
});

describe('the Draw bar', () => {
  it('draws Make curve and the two shape buttons with icons, and keeps Ink to shape Regular with the ring', async () => {
    await openPage({ draw: true });
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
  });
});

describe('the group dividers', () => {
  it('are a short line, 20 px tall (24 px with touch sizes), in place of a full-height border', async () => {
    const stops = [commandBar.replaceAll([])];
    for (const id of ['one', 'two']) {
      stops.push(
        commands.register(
          defineCommand({ id: `test.${id}`, title: 'commands.colors.ink', category: 'general', run() {} }),
        ),
      );
      stops.push(commandBar.register({ id, tab: 'home', group: id, command: `test.${id}`, priority: 50 }));
    }
    try {
      for (const [density, height] of [
        ['mouse', '20px'],
        ['touch', '24px'],
      ] as const) {
        await renderApp({ density });
        const slot = await waitFor(() => {
          const found = bar('Home').querySelector('[data-group-start]');
          expect(found).not.toBeNull();
          return found as HTMLElement;
        });
        expect(getComputedStyle(slot, '::before').height).toBe(height);
        expect(getComputedStyle(slot).borderInlineStartWidth).toBe('0px');
        expect(slot.getBoundingClientRect().height).toBeGreaterThan(parseFloat(height));
        disposeApp();
      }
    } finally {
      stops.forEach((stop) => stop());
    }
  });
});
