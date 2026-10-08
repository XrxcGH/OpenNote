/* eslint-disable opennote/feature-boundaries -- The shortcut editor's row list is what the test reads; the feature has no index. */
// Every tool window has a command, so the shortcut editor lists it and a chosen shortcut opens it. "Reset tool
// windows" puts the floating windows back where they first open.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { chord } from '../../../commands/registry';
import { commands } from '../../../registries';
import { assignShortcut } from '../../../state/keymap';
import { pressChord, renderApp } from '../../../test';
import { shortcutGroups } from '../../shortcuts/rows';
import { closeTool, openTool, openTools, resetToolWindows } from './host';
import { loadStored } from './storage';
import { TOOLS } from './tools';

afterEach(() => {
  for (const tool of TOOLS) closeTool(tool.id);
});

describe('tool window shortcuts', () => {
  it('give each tool a command the shortcut editor lists and lets the person change', async () => {
    await renderApp();
    const listed = shortcutGroups('').flatMap((group) => group.rows.map((row) => row.id));
    for (const tool of TOOLS) {
      const def = commands.get(`tools.${tool.id}`);
      expect(def, tool.id).toBeDefined();
      expect(def?.customizable, tool.id).not.toBe(false);
      expect(listed, tool.id).toContain(`tools.${tool.id}`);
    }
  });

  it('open a tool with the shortcut the person chose', async () => {
    await renderApp();
    await assignShortcut('tools.timers', chord('Ctrl+Alt+Shift+T'));
    await pressChord('Ctrl+Alt+Shift+T');
    await waitFor(() => expect(openTools()).toContain('timers'));
  });
});

describe('reset tool windows', () => {
  it('forgets where a floating window was moved and draws it at its first place', async () => {
    await renderApp();
    openTool('timers');
    const dialog = await screen.findByRole('dialog', { name: 'Timers' });
    const first = Math.round(dialog.getBoundingClientRect().left);
    const header = dialog.querySelector<HTMLElement>('[data-move]')!;
    header.focus();
    fireEvent.keyDown(header, { key: 'ArrowLeft' });
    expect(Math.round(dialog.getBoundingClientRect().left)).toBe(first - 16);
    expect(loadStored('place.timers', null)).not.toBeNull();
    await resetToolWindows();
    const again = await screen.findByRole('dialog', { name: 'Timers' });
    expect(Math.round(again.getBoundingClientRect().left)).toBe(first);
    expect(loadStored('place.timers', null)).toBeNull();
  });

  it('is a command in the palette list', async () => {
    await renderApp();
    expect(commands.get('tools.resetWindows')).toBeDefined();
  });
});
