// The mechanisms and dynamics kit window. Every tab works its first problem with results and steps. The tabs follow
// the ARIA pattern, and a unit that measures something else is marked on its field. A change of units keeps the
// values, the Insert menu puts the work into the page, and a palette command opens the window on its tool.
/* eslint-disable opennote/feature-boundaries -- The test reads the tool layer the window lives in. */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { commands } from '../../../../registries';
import { en } from '../../../../strings/en';
import { expectNoAxeViolations, renderApp, renderUi, setViewport } from '../../../../test';
import { INSERT_EVENT } from '../../../tools/flags';
import { closeTool, openTools } from '../../../tools/ui/host';
import { MECHDYN_TOOLS } from '../meta';
import { saveTab } from '../open';
import { PANEL_TYPES } from '../../../page/panels/kinds';
import { CalcBlock } from './CalcBlock';
import { MechDynKit } from './MechDynKit';

type Detail = {
  text?: string;
  math?: { source: string };
  table?: { rows: string[][] };
  picture?: object;
  panel?: { type: string; data: Record<string, unknown>; fallback: string };
};
const inserted: Detail[] = [];
window.addEventListener(INSERT_EVENT, (event: Event) => {
  const detail = (event as CustomEvent<Detail & { handled: boolean }>).detail;
  inserted.push({ ...detail });
  detail.handled = true;
});
afterEach(() => {
  inserted.splice(0);
  closeTool('kit-mechdyn');
  try {
    localStorage.clear();
  } catch {
    // Nothing saved.
  }
});

const words = en.kitMechDyn as unknown as Record<string, { short: string }>;

describe('the mechanisms and dynamics kit window', () => {
  it('works the first problem of every tab, with results and steps', async () => {
    renderUi(<MechDynKit />);
    for (const tool of MECHDYN_TOOLS) {
      await userEvent.click(screen.getByRole('tab', { name: words[tool.id].short }));
      const panel = screen.getByRole('tabpanel');
      expect(await within(panel).findByRole('region', { name: 'Results' }, { timeout: 15_000 }), tool.id).toBeTruthy();
      expect(within(panel).getByRole('region', { name: 'Worked steps' }), tool.id).toBeTruthy();
      await expectNoAxeViolations(panel);
    }
  }, 90_000);

  it('fits a narrow window', async () => {
    await setViewport(360, 720);
    renderUi(<MechDynKit />);
    const panel = screen.getByRole('tabpanel');
    await within(panel).findByRole('region', { name: 'Results' }, { timeout: 15_000 });
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
  });

  it('marks a unit that measures something else, and keeps values when the units change', async () => {
    saveTab('sdof');
    renderUi(<MechDynKit />);
    const mass = await screen.findByRole('textbox', { name: 'Mass, m' });
    await userEvent.fill(mass, '10 m');
    expect(await screen.findByText('m measures something else. Use a unit like kg.')).toBeTruthy();
    await userEvent.fill(mass, '10');
    const results = await screen.findByRole('region', { name: 'Results' });
    expect(within(results).getByText('20 rad/s')).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Units' }), 'us');
    expect((screen.getByRole('textbox', { name: 'Mass, m' }) as HTMLInputElement).value).toBe('10 kg');
    const us = screen.getByRole('region', { name: 'Results' });
    expect(within(us).getByText('20 rad/s')).toBeTruthy();
    expect(within(us).getByText('0.22841 lbf·s/in')).toBeTruthy();
  });

  it('moves between tabs with the arrow keys', async () => {
    renderUi(<MechDynKit />);
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    await userEvent.keyboard('{End}');
    expect(tabs[tabs.length - 1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);
    await userEvent.keyboard('{ArrowRight}');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('puts the answer, the equation, the table, the steps, and a plot into the page', async () => {
    saveTab('sdof');
    renderUi(<MechDynKit />);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Example' }), 'harmonic');
    const names = ['Answer line', 'Answer as an equation', 'Results table', 'Worked steps', /^Picture: /];
    for (const name of names) {
      await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
      await userEvent.click((await screen.findAllByRole('menuitem', { name }))[0]);
    }
    expect(inserted[0].text).toContain('Steady amplitude, X = 54.054 mm');
    expect(inserted[1].math?.source).toContain('X = 54.054\\,\\mathrm{mm}');
    expect(inserted[2].table?.rows.length).toBeGreaterThan(8);
    expect(inserted[3].text).toMatch(/^<p>Single-degree-of-freedom vibration<\/p><ol><li>/);
    expect(inserted[3].text).toContain('data-math=');
    expect(inserted[4].picture).toBeTruthy();
  });

  it('opens on the tool a palette command names', async () => {
    await renderApp();
    await commands.get('tools.kitMechDyn.sdof')!.run({} as never, undefined as never);
    await waitFor(() => expect(openTools()).toContain('kit-mechdyn'));
    const dialog = await screen.findByRole('dialog', { name: 'Mechanisms and dynamics' });
    const tab = await within(dialog).findByRole('tab', { name: words.sdof.short }, { timeout: 15_000 });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });
});

describe('the kit window and the page', () => {
  it('inserts a live calculation block that reopens the tool with its inputs', async () => {
    saveTab('sdof');
    const kit = renderUi(<MechDynKit />);
    await userEvent.fill(await screen.findByRole('textbox', { name: 'Mass, m' }), '12.5 kg');
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await userEvent.click((await screen.findAllByRole('menuitem', { name: 'Live calculation block' }))[0]);
    const panel = inserted[0].panel!;
    expect(panel.type).toBe(PANEL_TYPES.mechDynCalc);
    expect(panel.fallback).toContain('Single-degree-of-freedom vibration');
    // The page keeps the data as JSON; change the field in the window, then reopen from the block.
    const data = JSON.parse(JSON.stringify(panel.data)) as Record<string, unknown>;
    await userEvent.fill(screen.getByRole('textbox', { name: 'Mass, m' }), '3 kg');
    kit.unmount();
    renderUi(<MechDynKit />);
    renderUi(<CalcBlock data={data} readOnly={false} patch={() => undefined} announce={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open in the tool' }));
    // The panel remounts and loads its tool again, which can take a while on a busy machine.
    await waitFor(
      () => {
        const [mass] = screen.getAllByRole('textbox', { name: 'Mass, m' }) as HTMLInputElement[];
        expect(mass.value).toBe('12.5 kg');
      },
      { timeout: 15_000 },
    );
  });

  it('steps the linkage through its sweep and inserts the frame on screen', async () => {
    saveTab('linkage');
    renderUi(<MechDynKit />);
    const motion = await screen.findByRole('region', { name: 'Motion' }, { timeout: 15_000 });
    const slider = within(motion).getByRole('slider', { name: 'Frame' }) as HTMLInputElement;
    // A crank-rocker turns the full circle: a frame a degree, 0 to 360.
    expect(slider.max).toBe('360');
    expect(within(motion).getByText('Input angle 0°')).toBeTruthy();
    await userEvent.fill(slider, '90');
    expect(within(motion).getByText('Input angle 90°')).toBeTruthy();
    await userEvent.click(within(motion).getByRole('button', { name: 'Insert this frame' }));
    expect(inserted[0].picture).toBeTruthy();
    await userEvent.click(within(motion).getByRole('button', { name: 'Play' }));
    expect(within(motion).getByRole('button', { name: 'Pause' })).toBeTruthy();
  });
});
