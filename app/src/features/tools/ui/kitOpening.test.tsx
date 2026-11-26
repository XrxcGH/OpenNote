/* eslint-disable opennote/feature-boundaries -- The palette and command registry are how a kit is opened; the test uses them. */
// Opening a kit from the command palette: the command named after the kit reopens it on the tab it last showed, and
// a command named after a tab opens the kit on that tab (full walk 2, kit tabs).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { executeCommand } from '../../../commands/registry';
import { renderApp } from '../../../test';
import { announcements, clearAnnouncements } from '../../../ui';
import { commandsProvider } from '../../palette/commandsProvider';
import { closeTool, openTool, openTools } from './host';
import { saveStored } from './storage';
import { TOOLS } from './tools';

afterEach(() => {
  for (const tool of TOOLS) closeTool(tool.id);
  localStorage.clear();
});

// A narrow window shows its tabs as a menu, so the chosen tool is the menu's value there.
const selectedTab = async (window: string) => {
  const box = within(await screen.findByRole('dialog', { name: window }));
  const menu = await box.findByRole('combobox', { name: window }, { timeout: 8000 });
  return (menu as HTMLSelectElement).selectedOptions[0]?.textContent;
};

describe('opening a kit from the palette', () => {
  it('reopens the chemistry and materials kit on the tab it last showed', async () => {
    await renderApp();
    saveStored('chemmat.tab', 'solutions');
    await executeCommand('tools.kit-chemmat', undefined, 'palette');
    await waitFor(() => expect(openTools()).toContain('kit-chemmat'));
    expect(await selectedTab('Chemistry and materials')).toMatch(/solutions/i);
  });

  it('opens the kit on the tab a tab command names', async () => {
    await renderApp();
    await executeCommand('tools.kitChemMat.electrochem', undefined, 'palette');
    await waitFor(() => expect(openTools()).toContain('kit-chemmat'));
    expect(await selectedTab('Chemistry and materials')).toMatch(/electro/i);
  });
});

describe('finding a kit tab in the palette by its label', () => {
  const best = async (query: string) => {
    await renderApp();
    const found = await commandsProvider.search(query, new AbortController().signal);
    return [...found].sort((a, b) => b.score - a.score)[0]?.id;
  };

  const labels: readonly (readonly [string, string])[] = [
    ['Linkages', 'tools.kitMechDyn.linkage'],
    ['Cams', 'tools.kitMechDyn.cam'],
    ['Particles and bodies', 'tools.kitMechDyn.kinetics'],
    ['Rigid bodies in 3D', 'tools.kitMechDyn.rigid3d'],
    ['Vibration one mass', 'tools.kitMechDyn.sdof'],
    ['Vibration many masses', 'tools.kitMechDyn.mdof'],
  ];
  // Other tools also have these words in their titles (Systems of ODEs), so the tab is listed rather than first.
  const shared: readonly (readonly [string, string])[] = [
    ['Systems', 'tools.kitControl.systems'],
    ['Semiconductors', 'kits.electrical.semis'],
  ];
  for (const [label, id] of labels) {
    it(`finds ${label}`, async () => expect(await best(label)).toBe(`command:${id}`));
  }
  for (const [label, id] of shared) {
    it(`lists ${label}`, async () => {
      await renderApp();
      const found = await commandsProvider.search(label, new AbortController().signal);
      expect(found.filter((one) => one.score > 0).map((one) => one.id)).toContain(`command:${id}`);
    });
  }
});

describe('Open in its own window', () => {
  it('says so when the app cannot open the tool in a window of its own', async () => {
    await renderApp();
    clearAnnouncements();
    // The app's command bridge is there but fails, as it did for the tools its window list lacked.
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    try {
      openTool('chemcalc');
      fireEvent.click(await screen.findByRole('button', { name: 'Open in its own window' }));
      await waitFor(() =>
        expect(announcements().join(' ')).toMatch(/Chemistry calculators couldn.t open in its own window/),
      );
      expect(openTools()).toContain('chemcalc');
    } finally {
      Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    }
  });
});

describe('Escape in a kit window', () => {
  for (const id of ['kit-design', 'kit-mechdyn', 'chemcalc'] as const) {
    it(`closes the ${id} window from a tab`, async () => {
      await renderApp();
      openTool(id);
      const box = within(await screen.findByRole('dialog'));
      const tab = (await box.findAllByRole('tab', {}, { timeout: 8000 }))[0]!;
      tab.focus();
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(openTools()).not.toContain(id));
    });
  }
});
