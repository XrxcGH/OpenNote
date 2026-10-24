// The fluid and heat transfer kit window. Every tab works its first problem with results and steps, the tabs follow
// the ARIA pattern, a unit that measures something else is marked on its field, a change of units keeps the values,
// and the Insert menu puts the work into the page. The palette opens a tool.
/* eslint-disable opennote/feature-boundaries -- The test reads the tool layer the window lives in. */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { commands } from '../../../../registries';
import { en } from '../../../../strings/en';
import { expectNoAxeViolations, renderApp, renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../../tools/flags';
import { closeTool, openTools } from '../../../tools/ui/host';
import { FLUIDHEAT_TOOLS } from '../meta';
import { saveTab } from '../open';
import { FluidHeatKit } from './FluidHeatKit';

type Detail = { text?: string; math?: { source: string }; table?: { rows: string[][] }; picture?: object };
const inserted: Detail[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<Detail & { handled: boolean }>).detail;
  inserted.push({ ...detail });
  detail.handled = true;
};
window.addEventListener(INSERT_EVENT, listen);
afterEach(() => {
  inserted.splice(0);
  closeTool('kit-fluidheat');
  try {
    localStorage.clear();
  } catch {
    // Nothing saved.
  }
});

const titleOf = (id: string) => (en.kitFluidHeat as unknown as Record<string, { title: string }>)[id].title;

describe('the fluid and heat transfer kit window', () => {
  it('works the first problem of every tab, with results and steps', async () => {
    renderUi(<FluidHeatKit />);
    for (const tool of FLUIDHEAT_TOOLS) {
      await userEvent.click(screen.getByRole('tab', { name: titleOf(tool.id) }));
      const panel = screen.getByRole('tabpanel');
      expect(await within(panel).findByRole('region', { name: 'Results' }, { timeout: 10_000 }), tool.id).toBeTruthy();
      expect(within(panel).getByRole('region', { name: 'Worked steps' }), tool.id).toBeTruthy();
    }
    await expectNoAxeViolations(screen.getByRole('tablist').parentElement!);
  });

  it('marks a unit that measures something else, and keeps values when the units change', async () => {
    saveTab('statics');
    renderUi(<FluidHeatKit />);
    const width = await screen.findByRole('textbox', { name: 'Width, or diameter of a circle, b' });
    await userEvent.fill(width, '3 kN');
    expect(await screen.findByText('That unit measures something else. This field takes m, not kN.')).toBeTruthy();
    await userEvent.fill(width, '2');
    const results = await screen.findByRole('region', { name: 'Results' });
    expect(within(results).getByText('51485 N')).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Units' }), 'us');
    expect((screen.getByRole('textbox', { name: 'Width, or diameter of a circle, b' }) as HTMLInputElement).value).toBe(
      '2 m',
    );
    expect(await within(screen.getByRole('region', { name: 'Results' })).findByText('11574 lbf')).toBeTruthy();
  });

  it('moves between tabs with the arrow keys', async () => {
    renderUi(<FluidHeatKit />);
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    await userEvent.keyboard('{End}');
    expect(tabs[tabs.length - 1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);
    await userEvent.keyboard('{ArrowRight}');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('puts the answer, the equation, the table, the steps, and the picture into the page', async () => {
    saveTab('statics');
    renderUi(<FluidHeatKit />);
    await screen.findByRole('region', { name: 'Results' });
    for (const name of ['Answer line', 'Equation', 'Result table', 'Worked steps', 'Picture']) {
      await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
      await userEvent.click(await screen.findByRole('menuitem', { name }));
    }
    expect(inserted[0].text).toContain('Resultant force, F = 51485 N');
    expect(inserted[1].math?.source).toContain('F = 51485');
    expect(inserted[2].table?.rows.length).toBeGreaterThan(4);
    expect(inserted[3].text).toMatch(/^<p>Fluid statics, Bernoulli, and flow measurement<\/p><ol><li>/);
    expect(inserted[3].text).toContain('data-math=');
    expect(inserted[4].picture).toBeTruthy();
  });

  it('opens on the tool a palette command names', async () => {
    await renderApp();
    await commands.get('tools.kitFluidHeat.statics')!.run({} as never, undefined as never);
    await waitFor(() => expect(openTools()).toContain('kit-fluidheat'));
    const dialog = await screen.findByRole('dialog', { name: 'Fluids and heat transfer' });
    const tab = await within(dialog).findByRole('tab', { name: titleOf('statics') }, { timeout: 15_000 });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });
});
