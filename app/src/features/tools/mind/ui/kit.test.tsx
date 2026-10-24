// The psychology and behavior kit window. Every tab works its first problem with results and steps, the tabs follow
// the ARIA pattern, a field with a problem says so, and the Insert menu puts the work into the page. The palette
// opens a tool.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { commands } from '../../../../registries';
import { en } from '../../../../strings/en';
import { expectNoAxeViolations, renderApp, renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../flags';
import { closeTool, openTools } from '../../ui/host';
import { MIND_TOOLS } from '../meta';
import { saveTab } from '../open';
import { MindKit } from './MindKit';

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
  closeTool('kit-mind');
  try {
    localStorage.clear();
  } catch {
    // Nothing saved.
  }
});

const titleOf = (id: string) => (en.kitMind as unknown as Record<string, { title: string }>)[id].title;

describe('the psychology and behavior kit window', () => {
  it('works the first problem of every tab, with results and steps', async () => {
    renderUi(<MindKit />);
    for (const tool of MIND_TOOLS) {
      await userEvent.click(screen.getByRole('tab', { name: titleOf(tool.id) }));
      const panel = screen.getByRole('tabpanel');
      expect(await within(panel).findByRole('region', { name: 'Results' }, { timeout: 10_000 }), tool.id).toBeTruthy();
      expect(within(panel).getByRole('region', { name: 'Worked steps' }), tool.id).toBeTruthy();
    }
    await expectNoAxeViolations(screen.getByRole('tablist').parentElement!);
  });

  it('moves between tabs with the arrow keys', async () => {
    renderUi(<MindKit />);
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    await userEvent.keyboard('{End}');
    expect(tabs[tabs.length - 1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);
    await userEvent.keyboard('{ArrowRight}');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('marks a field with a problem', async () => {
    saveTab('sdt');
    renderUi(<MindKit />);
    const hits = await screen.findByRole('textbox', { name: 'Hits' });
    await userEvent.fill(hits, 'many');
    expect(await screen.findByText('This needs a number, such as 0.8 or 12.')).toBeTruthy();
    expect(hits.getAttribute('aria-invalid')).toBe('true');
  });

  it('puts the answer, the equation, the table, the steps, and the picture into the page', async () => {
    saveTab('sdt');
    renderUi(<MindKit />);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Example' }), 'symmetric');
    await waitFor(() => expect(screen.getAllByText('1.68324').length).toBeGreaterThan(0));
    const names = ['Answer line', 'Answer as an equation', 'Result table', 'Worked steps', /^Picture/];
    for (const name of names) {
      await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
      await userEvent.click(await screen.findByRole('menuitem', { name }));
    }
    expect(inserted[0].text).toContain('Sensitivity d′ = 1.68324');
    expect(inserted[1].math?.source).toContain("d' = 1.68324");
    expect(inserted[2].table?.rows.length).toBeGreaterThan(4);
    expect(inserted[3].text).toMatch(/^<p>Signal detection<\/p><ol><li>/);
    expect(inserted[3].text).toContain('data-math=');
    expect(inserted[4].picture).toBeTruthy();
  });

  it('opens on the tool a palette command names', async () => {
    await renderApp();
    await commands.get('tools.kitMind.sdt')!.run({} as never, undefined as never);
    await waitFor(() => expect(openTools()).toContain('kit-mind'));
    const dialog = await screen.findByRole('dialog', { name: 'Psychology and behavior' });
    const tab = await within(dialog).findByRole('tab', { name: titleOf('sdt') }, { timeout: 15_000 });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });
});
