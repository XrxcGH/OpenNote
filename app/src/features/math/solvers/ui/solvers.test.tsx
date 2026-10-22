// The Math solvers window: every tab works its default problem with a graph and steps, the tabs follow the ARIA
// pattern, a change of input works the problem again, the steps go into the page, and the palette opens a solver.
/* eslint-disable opennote/feature-boundaries -- The test reads the tool layer the window lives in. */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { commands } from '../../../../registries';
import { expectNoAxeViolations, renderApp, renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../../tools/flags';
import { closeTool, openTools } from '../../../tools/ui/host';
import { SolversTool } from './SolversTool';
import { SOLVER_TABS, chooseTab } from './state';

const inserted: string[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<{ text?: string; graph?: string; handled: boolean }>).detail;
  inserted.push(detail.text ?? detail.graph ?? '');
  detail.handled = true;
};
window.addEventListener(INSERT_EVENT, listen);
afterEach(() => {
  inserted.splice(0);
  closeTool('solvers');
  try {
    localStorage.clear();
  } catch {
    // Nothing saved.
  }
});

describe('the Math solvers window', () => {
  it('works the default problem of every tab, with a picture and steps', async () => {
    chooseTab('integrals');
    renderUi(<SolversTool />);
    for (const tab of SOLVER_TABS) {
      await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tabName(tab)}$`) }));
      const panel = screen.getByRole('tabpanel');
      // A ball in spherical coordinates has no flat region to draw, and errors have no graph; the rest have a picture.
      if (tab !== 'integrals' && tab !== 'errors')
        expect(within(panel).queryAllByRole('img').length, tab).toBeGreaterThan(0);
      expect(within(panel).getAllByRole('region', { name: 'Worked steps' }).length, tab).toBeGreaterThan(0);
      expect(
        within(panel)
          .queryAllByRole('status')
          .some((one) => one.textContent?.trim()),
        tab,
      ).toBe(true);
    }
  });

  it('finds the volume of a ball and works it again when the radius changes', async () => {
    chooseTab('integrals');
    renderUi(<SolversTool />);
    expect(await screen.findByText('Value: 4π/3')).toBeTruthy();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Radius R' }), '3');
    expect(await screen.findByText('Value: 36π')).toBeTruthy();
    await expectNoAxeViolations(screen.getByRole('tablist').parentElement!);
  });

  it('moves between tabs with the arrow keys', async () => {
    chooseTab('integrals');
    renderUi(<SolversTool />);
    const first = screen.getByRole('tab', { name: 'Integrals' });
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    const second = screen.getByRole('tab', { name: 'Equations' });
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(second);
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Projectile' }).getAttribute('aria-selected')).toBe('true');
  });

  it('says what is wrong with an equation, and puts the worked steps into the page', async () => {
    chooseTab('roots');
    renderUi(<SolversTool />);
    expect(await screen.findByText(/Root: x ≈ 2\.0945514815/)).toBeTruthy();
    await userEvent.fill(screen.getByRole('textbox', { name: 'f(x)' }), 'x^2 +');
    expect(await screen.findByText(/couldn't be read as math/)).toBeTruthy();
    await userEvent.fill(screen.getByRole('textbox', { name: 'f(x)' }), 'x^2 - 2');
    await userEvent.click(screen.getByRole('button', { name: 'Insert steps into page' }));
    expect(inserted[0]).toContain("Newton's method follows the tangent line");
    await userEvent.click(screen.getByRole('button', { name: 'Graph in page' }));
    expect(inserted[1]).toBe('y = x^2 - 2');
  });

  it('opens on the solver a palette command names', async () => {
    await renderApp();
    await commands.get('tools.solvers.matrices')!.run({} as never, undefined as never);
    await waitFor(() => expect(openTools()).toContain('solvers'));
    const dialog = await screen.findByRole('dialog', { name: 'Math solvers' });
    const tab = await within(dialog).findByRole('tab', { name: 'Matrices' }, { timeout: 15_000 });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    await waitFor(() => {
      const texts = within(dialog)
        .getAllByRole('status')
        .map((one) => one.textContent ?? '');
      expect(
        texts.some((text) => /λ = 3, +λ = 1/.test(text)),
        texts.join(' | '),
      ).toBe(true);
    });
  });
});

function tabName(tab: string): string {
  return { errors: 'Errors and units' }[tab] ?? tab[0].toUpperCase() + tab.slice(1);
}
