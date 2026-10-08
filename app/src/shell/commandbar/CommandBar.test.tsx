import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { chord, defineCommand } from '../../commands/registry';
import type { CommandDef } from '../../commands/types';
import { commandBar, commands, contextMenus, titleBarItems } from '../../registries';
import type { CommandBarItem } from '../../registries/types';
import type { MessageKey } from '../../strings/t';
import { expectFocus, expectNoAxeViolations, renderApp, setViewport } from '../../test';
import { registerRegionMain } from '../regions';

const stops: (() => void)[] = [];

// The features register real tools, so each test starts from a bare command bar and adds its own.
beforeEach(() => {
  stops.push(commandBar.replaceAll([]));
});

afterEach(async () => {
  stops.splice(0).forEach((stop) => stop());
  await setViewport(1280, 800);
});

function command(id: string, title: MessageKey, rest: Partial<CommandDef> = {}) {
  stops.push(commands.register(defineCommand({ id: `test.${id}`, title, category: 'general', run() {}, ...rest })));
}

function tool(id: string, rest: Partial<CommandBarItem> = {}) {
  stops.push(commandBar.register({ id, tab: 'home', group: 'a', command: `test.${id}`, priority: 50, ...rest }));
}

const COLORS = ['ink', 'indigo', 'brick', 'fern', 'plum', 'amber', 'walnut'] as const;

describe('the command bar tabs', () => {
  it('shows tabs that switch with arrow keys, and each tab has its toolbar', async () => {
    command('ink', 'commands.colors.ink');
    command('fern', 'commands.colors.fern', { keys: [chord('Ctrl+Alt+F')] });
    tool('ink');
    tool('fern', { tab: 'view' });
    tool('hidden', { tab: 'insert', flag: 'commandBar.insert' });
    await renderApp({ boot: { channel: 'stable' } });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Home', 'View']);
    expect(screen.getByRole('toolbar', { name: 'Home' })).toBeTruthy();
    tabs[0].focus();
    await userEvent.keyboard('{ArrowRight}');
    await expectFocus(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    const view = screen.getByRole('toolbar', { name: 'View' });
    const fern = within(view).getByRole('button', { name: 'Fern' });
    expect(fern.getAttribute('aria-keyshortcuts')).toBe('Control+Alt+F');
    await userEvent.hover(fern);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Fern (Ctrl+Alt+F)');
    await expectNoAxeViolations(document.body);
  });

  it('moves between tools with arrow keys, keeps one tool in the tab order, and Escape goes to the page', async () => {
    for (const color of COLORS.slice(0, 3)) {
      command(color, `commands.colors.${color}`);
      tool(color);
    }
    await renderApp();
    const heading = document.querySelector<HTMLElement>('main h1');
    heading?.setAttribute('tabindex', '-1');
    stops.push(registerRegionMain('page', () => heading));
    const toolbar = screen.getByRole('toolbar', { name: 'Home' });
    const tools = within(toolbar).getAllByRole('button');
    expect(tools.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
    tools[0].focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    await expectFocus(tools[2]);
    await userEvent.keyboard('{ArrowRight}');
    await expectFocus(tools[0]);
    await userEvent.keyboard('{End}');
    expect(tools.map((button) => button.tabIndex)).toEqual([-1, -1, 0]);
    // These tools have no shortcut, so they show no tooltip to take the first Escape: it leaves for the page.
    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.keyboard('{Escape}');
    await expectFocus(heading as HTMLElement);
  });
});

describe('the command bar tools', () => {
  it('runs commands, and shows toggles, disabled tools, and menus', async () => {
    const ran = vi.fn();
    command('ink', 'commands.colors.ink', { run: ran });
    command('fern', 'commands.colors.fern', { checked: () => true });
    command('plum', 'commands.colors.plum', { enabled: () => false, run: ran });
    command('amber', 'commands.colors.amber');
    command('choice', 'commands.colors.walnut', { run: ran });
    tool('ink');
    tool('fern', { presentation: 'toggle' });
    tool('plum');
    tool('amber', { presentation: 'menu', menu: 'view.paneWidths' });
    stops.push(
      contextMenus.register({ id: 'c', menu: 'view.paneWidths', command: 'test.choice', group: 'g', order: 0 }),
    );
    await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Ink' }));
    expect(screen.getByRole('button', { name: 'Fern' }).getAttribute('aria-pressed')).toBe('true');
    const plum = screen.getByRole('button', { name: 'Plum' });
    expect(plum.getAttribute('aria-disabled')).toBe('true');
    plum.click();
    const amber = screen.getByRole('button', { name: 'Amber' });
    expect(amber.getAttribute('aria-haspopup')).toBe('menu');
    await userEvent.click(amber);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Walnut' }));
    await vi.waitFor(() => expect(ran).toHaveBeenCalledTimes(2));
  });
});

describe('the command bar overflow', () => {
  it('moves the lowest-priority tools into More when the bar is narrow', async () => {
    const ran = vi.fn();
    COLORS.forEach((color, i) => {
      command(color, `commands.colors.${color}`, { run: () => ran(color) });
      tool(color, { priority: 100 - i });
    });
    const longer = ['commands.bar.shortcuts', 'commands.bar.settings', 'commands.bar.notebooks'] as const;
    longer.forEach((title, i) => {
      command(`long${i}`, title);
      tool(`long${i}`, { priority: 200 });
    });
    await setViewport(640, 800);
    await renderApp({ sizeClass: 'medium' });
    const toolbar = screen.getByRole('toolbar', { name: 'Home' });
    const more = await within(toolbar).findByRole('button', { name: 'More commands' });
    const shown = within(toolbar)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(shown[0]).toBe('Ink');
    expect(shown).not.toContain('Walnut');
    await userEvent.click(more);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Walnut' }));
    await vi.waitFor(() => expect(ran).toHaveBeenCalledWith('walnut'));
  });
});

describe('the bottom bar', () => {
  it('shows in compact with the actions whose commands exist, and More holds the rest', async () => {
    stops.push(
      titleBarItems.register({
        id: 'test.chip',
        side: 'end',
        order: 1,
        priority: 1,
        compact: 'bottomMore',
        Component: () => <button type="button">{'Update ready'}</button>,
      }),
    );
    await renderApp({ sizeClass: 'compact' });
    expect(screen.queryByRole('tablist')).toBeNull();
    const bar = screen.getByRole('navigation', { name: 'Quick actions' });
    expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Notebooks', 'Search', 'New page', 'More']);
    const more = within(bar).getByRole('button', { name: 'More commands' });
    await userEvent.click(more);
    const panel = await screen.findByRole('dialog', { name: 'More commands' });
    expect(
      within(panel)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Settings', 'Keyboard shortcuts', 'Update ready', 'Trash']);
    await userEvent.keyboard('{Escape}');
    await expectFocus(more);
    await expectNoAxeViolations(document.body);
  });
});
