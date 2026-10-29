// The solid mechanics kit window. Every tab works its first problem with results and steps, the tabs follow the ARIA
// pattern, a unit that measures something else is marked on its field, a change of units keeps the values, and the
// Insert menu puts the work into the page. The palette opens a tool.
/* eslint-disable opennote/feature-boundaries -- The test reads the tool layer the window lives in. */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { commands } from '../../../../registries';
import { en } from '../../../../strings/en';
import { expectNoAxeViolations, renderApp, renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../../tools/flags';
import { closeTool, openTools } from '../../../tools/ui/host';
import { SOLIDS_TOOLS } from '../meta';
import { CALC_EVENT, saveTab, type KitCalcRequest } from '../open';
import { KitCalcPanel } from './KitCalcPanel';
import { SolidsKit } from './SolidsKit';

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
  closeTool('kit-solids');
  try {
    localStorage.clear();
  } catch {
    // Nothing saved.
  }
});

const titleOf = (id: string) => (en.kitSolids as unknown as Record<string, { title: string }>)[id].title;

describe('the solid mechanics kit window', () => {
  it('works the first problem of every tab, with results and steps', async () => {
    renderUi(<SolidsKit />);
    for (const tool of SOLIDS_TOOLS) {
      await userEvent.click(screen.getByRole('tab', { name: titleOf(tool.id) }));
      const panel = screen.getByRole('tabpanel');
      expect(await within(panel).findByRole('region', { name: 'Results' }, { timeout: 10_000 }), tool.id).toBeTruthy();
      expect(within(panel).getByRole('region', { name: 'Worked steps' }), tool.id).toBeTruthy();
    }
    await expectNoAxeViolations(screen.getByRole('tablist').parentElement!);
  });

  it('marks a unit that measures something else, and keeps values when the units change', async () => {
    saveTab('columns');
    renderUi(<SolidsKit />);
    const length = await screen.findByRole('textbox', { name: 'Length, L' });
    await userEvent.fill(length, '3 kN');
    expect(await screen.findByText('That unit measures something else. This field takes m, not kN.')).toBeTruthy();
    await userEvent.fill(length, '3');
    const results = await screen.findByRole('region', { name: 'Results' });
    expect(within(results).getByText('1754.6 kN')).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Units' }), 'us');
    expect((screen.getByRole('textbox', { name: 'Length, L' }) as HTMLInputElement).value).toBe('3 m');
    expect(await within(screen.getByRole('region', { name: 'Results' })).findByText('394.45 kip')).toBeTruthy();
  });

  it('moves between tabs with the arrow keys', async () => {
    renderUi(<SolidsKit />);
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    await userEvent.keyboard('{End}');
    expect(tabs[tabs.length - 1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);
    await userEvent.keyboard('{ArrowRight}');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('puts the answer, the equation, the table, the steps, and the picture into the page', async () => {
    saveTab('columns');
    renderUi(<SolidsKit />);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Example' }), 'johnson');
    for (const name of ['Answer line', 'Equation', 'Result table', 'Worked steps', 'Picture']) {
      await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
      await userEvent.click(await screen.findByRole('menuitem', { name }));
    }
    expect(inserted[0].text).toContain('Euler critical load, Pcr = 1754.6 kN');
    expect(inserted[1].math?.source).toContain('P_{cr} = 1754.6');
    expect(inserted[2].table?.rows.length).toBeGreaterThan(4);
    expect(inserted[3].text).toMatch(/^<p>Columns and buckling<\/p><ol><li>/);
    expect(inserted[3].text).toContain('data-math=');
    expect(inserted[4].picture).toBeTruthy();
  });

  it('keeps a live calculation that opens the tool on its values again', async () => {
    const asked: KitCalcRequest[] = [];
    const keep = (event: Event) => {
      const request = (event as CustomEvent<KitCalcRequest>).detail;
      asked.push(request);
      request.handled = true;
    };
    window.addEventListener(CALC_EVENT, keep);
    try {
      saveTab('columns');
      renderUi(<SolidsKit />);
      await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Example' }), 'johnson');
      await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Live calculation' }));
      expect(asked).toHaveLength(1);
      const data = asked[0].data;
      expect(data).toMatchObject({ tool: 'columns', system: 'si' });
      expect(data.texts.L).toBe('3 m');
      expect(data.summary).toContain('1754.6 kN');
      expect(asked[0].fallback).toContain('L = 3 m');
      // The student changes the length, then opens the calculation from the page: the length comes back.
      const length = screen.getAllByRole('textbox', { name: 'Length, L' })[0];
      await userEvent.fill(length, '5 m');
      renderUi(<KitCalcPanel data={{ ...data }} readOnly={false} patch={() => {}} announce={() => {}} />);
      await userEvent.click(screen.getByRole('button', { name: 'Open in the tool' }));
      await waitFor(() =>
        expect((screen.getAllByRole('textbox', { name: 'Length, L' })[0] as HTMLInputElement).value).toBe('3 m'),
      );
    } finally {
      window.removeEventListener(CALC_EVENT, keep);
    }
  });

  it('opens on the tool a palette command names', async () => {
    await renderApp();
    await commands.get('tools.kitSolids.columns')!.run({} as never, undefined as never);
    await waitFor(() => expect(openTools()).toContain('kit-solids'));
    const dialog = await screen.findByRole('dialog', { name: 'Solid mechanics' });
    const tab = await within(dialog).findByRole('tab', { name: titleOf('columns') }, { timeout: 15_000 });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });
});
