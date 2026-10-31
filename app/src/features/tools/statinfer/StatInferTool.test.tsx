// The statistics kit window. Every tab works its first example to a result, and the tabs follow the ARIA pattern.
// A problem with the input is said in words. The Insert menu puts results into the page, and the palette has a
// command for every tool.
/* eslint-disable opennote/feature-boundaries -- The test reads the palette list the registration keeps. */
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { STAT_COMMANDS } from '../../page/registrations/kitStatInfer';
import { INSERT_EVENT } from '../flags';
import { selectKitTab } from '../kits/registry';
import { STAT_KIT_ID, STAT_TOOLS } from './meta';
import { StatInferTool } from './StatInferTool';

const inserted: Record<string, unknown>[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<Record<string, unknown> & { handled: boolean }>).detail;
  inserted.push(detail);
  detail.handled = true;
};
window.addEventListener(INSERT_EVENT, listen);

afterEach(() => {
  inserted.splice(0);
  try {
    localStorage.clear();
  } catch {
    // Nothing saved.
  }
});

describe('the statistics kit window', () => {
  it('works the first example of every tool to a result', async () => {
    selectKitTab(STAT_KIT_ID, STAT_TOOLS[0][0]);
    renderUi(<StatInferTool />);
    for (const [tool] of STAT_TOOLS) {
      selectKitTab(STAT_KIT_ID, tool);
      const panel = await screen.findByRole('tabpanel');
      // The first visit to a tab loads its code, which can take a while on a busy machine.
      expect(await within(panel).findByRole('region', { name: 'Results' }, { timeout: 30_000 }), tool).toBeTruthy();
    }
    await expectNoAxeViolations(screen.getByRole('tablist').parentElement!);
  }, 120_000);

  it('says what is wrong with the data and inserts the answer line', async () => {
    selectKitTab(STAT_KIT_ID, 'describe');
    renderUi(<StatInferTool />);
    const data = await screen.findByRole('textbox', { name: 'Data' });
    await userEvent.fill(data, '1, two, 3');
    expect(await screen.findByText('“two” is not a number.')).toBeTruthy();
    await userEvent.fill(data, '2, 4, 4, 4, 5, 5, 7, 9');
    expect(await screen.findByText('Mean 5, standard deviation 2.13809, n = 8.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Insert into page' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Answer line' }));
    expect(inserted.at(-1)?.text).toBe('Mean 5, standard deviation 2.13809, n = 8.');
  });

  it('moves between tabs with the arrow keys', async () => {
    selectKitTab(STAT_KIT_ID, STAT_TOOLS[0][0]);
    renderUi(<StatInferTool />);
    const first = screen.getAllByRole('tab')[0];
    first.focus();
    await userEvent.keyboard('{End}');
    expect(screen.getAllByRole('tab').at(-1)?.getAttribute('aria-selected')).toBe('true');
  });

  it('says the epidemiology tool is for coursework, not clinical use', async () => {
    selectKitTab(STAT_KIT_ID, 'epi');
    renderUi(<StatInferTool />);
    const panel = await screen.findByRole('tabpanel');
    expect(
      await within(panel).findByText(
        'For coursework only, not for clinical use; this tool gives no diagnostic or treatment advice.',
        undefined,
        { timeout: 30_000 },
      ),
    ).toBeTruthy();
  }, 60_000);

  it('has a palette command for every tool', () => {
    expect(STAT_COMMANDS).toEqual(STAT_TOOLS.map(([tool, icon]) => [tool, icon]));
  });
});
