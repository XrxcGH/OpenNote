// The statistical models kit window. Every tab works its first problem with results and steps, the tabs follow the
// ARIA pattern, a column of words where numbers belong is reported in words, columns are picked by name, and the
// Insert menu puts the work into the page. The palette opens a tool.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { commands } from '../../../../registries';
import { en } from '../../../../strings/en';
import { expectNoAxeViolations, renderApp, renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../flags';
import { closeTool, openTools } from '../../ui/host';
import { STATMODELS_TOOLS } from '../meta';
import { saveTab } from '../open';
import { StatModelsKit } from './StatModelsKit';

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
  closeTool('kit-statmodels');
  try {
    localStorage.clear();
  } catch {
    // Nothing saved.
  }
});

const titleOf = (id: string) => (en.kitStatModels as unknown as Record<string, { title: string }>)[id].title;

describe('the statistical models kit window', () => {
  it('works the first problem of every tab, with results and steps', async () => {
    renderUi(<StatModelsKit />);
    for (const tool of STATMODELS_TOOLS) {
      await userEvent.click(screen.getByRole('tab', { name: titleOf(tool.id) }));
      const panel = screen.getByRole('tabpanel');
      expect(await within(panel).findByRole('region', { name: 'Results' }, { timeout: 15_000 }), tool.id).toBeTruthy();
      expect(within(panel).getByRole('region', { name: 'Worked steps' }), tool.id).toBeTruthy();
    }
    await expectNoAxeViolations(screen.getByRole('tablist').parentElement!);
  });

  it('reports a word in a column of numbers, and picks columns by name', async () => {
    saveTab('glm');
    renderUi(<StatModelsKit />);
    const data = await screen.findByRole('textbox', { name: 'Data' });
    await userEvent.fill(data, 'hours,passed\n0,0\n1,0\n2,0\n3,1\n4,0\nfive,1\n6,1\n7,0\n8,1\n9,1');
    expect(await screen.findByText('The column hours needs numbers, but it has five.')).toBeTruthy();
    await userEvent.fill(
      data,
      'hours,passed,extra\n0,0,1\n1,0,1\n2,0,2\n3,1,2\n4,0,3\n5,1,3\n6,1,4\n7,0,4\n8,1,5\n9,1,6',
    );
    const predictors = screen.getByRole('group', { name: 'Predictors' });
    expect(within(predictors).getAllByRole('checkbox')).toHaveLength(3);
    await userEvent.click(within(predictors).getByRole('checkbox', { name: 'extra' }));
    const coefficients = await screen.findByRole('region', { name: 'Coefficients on the link scale' });
    expect(await within(coefficients).findByText('extra')).toBeTruthy();
  });

  it('moves between tabs with the arrow keys', async () => {
    renderUi(<StatModelsKit />);
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    await userEvent.keyboard('{End}');
    expect(tabs[tabs.length - 1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);
    await userEvent.keyboard('{ArrowRight}');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('puts the answer, the equation, the table, the steps, the words, and a picture into the page', async () => {
    saveTab('glm');
    renderUi(<StatModelsKit />);
    await screen.findByRole('region', { name: 'Results' }, { timeout: 15_000 });
    const names = ['Answer line', 'Equation', 'Result table', 'Worked steps', 'Result in words', /^Picture: /];
    for (const name of names) {
      await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
      await userEvent.click((await screen.findAllByRole('menuitem', { name }))[0]);
    }
    expect(inserted[0].text).toContain('Odds or rate ratio, first predictor = 1.7224');
    expect(inserted[1].math?.source).toContain('\\operatorname{logit}(\\hat\\pi) = -2.4466 + 0.5437');
    expect(inserted[2].table?.rows.length).toBeGreaterThan(8);
    expect(inserted[3].text).toMatch(/^<p>Logistic and Poisson regression<\/p><ol><li>/);
    expect(inserted[3].text).toContain('data-math=');
    expect(inserted[4].text).toContain('multiplies the odds of passed by 1.7224');
    expect(inserted[5].picture).toBeTruthy();
  });

  it('opens on the tool a palette command names', async () => {
    await renderApp();
    await commands.get('tools.kitStatModels.glm')!.run({} as never, undefined as never);
    await waitFor(() => expect(openTools()).toContain('kit-statmodels'));
    const dialog = await screen.findByRole('dialog', { name: 'Statistical models' });
    const tab = await within(dialog).findByRole('tab', { name: titleOf('glm') }, { timeout: 15_000 });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });
});
