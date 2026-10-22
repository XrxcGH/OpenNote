// The reference tables show each element's group number and electron configuration, and insert them at the caret.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { INSERT_EVENT } from '../flags';
import { ReferenceTool } from './ReferenceTool';

const inserted: string[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<{ text?: string; handled: boolean }>).detail;
  if (detail.text !== undefined) inserted.push(detail.text);
  detail.handled = true;
};
window.addEventListener(INSERT_EVENT, listen);
afterEach(() => inserted.splice(0));

describe('the reference tables', () => {
  it('show the group number and electron configuration of an element', async () => {
    renderUi(<ReferenceTool />);
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search' }), 'iron');
    const row = screen.getByRole('row', { name: /Fe/ });
    expect(within(row).getByText('[Ar] 3d⁶ 4s²')).toBeTruthy();
    expect(within(row).getByText('8')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Electron configuration' })).toBeTruthy();
  });

  it('says when nothing matches, and starts another table with all its rows', async () => {
    renderUi(<ReferenceTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search' }), 'zzz');
    expect(screen.getByRole('status').textContent).toContain('zzz');
    await userEvent.click(screen.getByRole('tab', { name: 'Constants' }));
    expect((screen.getByRole('textbox', { name: 'Search' }) as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows no group for an element of the f-block, and says so in words', async () => {
    renderUi(<ReferenceTool />);
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search' }), 'cerium');
    expect(within(screen.getByRole('row', { name: /Ce/ })).getByText('None')).toBeTruthy();
  });

  it('inserts the symbol, or the symbol with its configuration, at the caret', async () => {
    renderUi(<ReferenceTool />);
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search' }), 'copper');
    await userEvent.click(screen.getByRole('button', { name: 'Insert Copper into the page' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Insert the electron configuration of Copper into the page' }),
    );
    expect(inserted).toEqual(['Cu', 'Cu: [Ar] 3d¹⁰ 4s¹']);
  });

  it('opens on a grid with a card of facts, and the arrow keys move between elements', async () => {
    renderUi(<ReferenceTool />);
    const hydrogen = screen.getByRole('button', { name: /^Hydrogen, symbol H, atomic number 1/ });
    expect(hydrogen.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('region', { name: 'Hydrogen' })).toBeTruthy();
    hydrogen.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Lithium/);
    await userEvent.keyboard('{End}');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Neon/);
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Fluorine/);
    const card = screen.getByRole('region', { name: 'Fluorine' });
    expect(within(card).getByText('Electronegativity (Pauling)')).toBeTruthy();
    expect(within(card).getByText('3.98')).toBeTruthy();
    // Only one button is in the tab order.
    const cells = screen.getAllByRole('button', { name: /atomic number/ });
    expect(cells.filter((one) => one.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('shows density, melting and boiling points, oxidation states, and isotopes on the card', async () => {
    renderUi(<ReferenceTool />);
    await userEvent.click(screen.getByRole('button', { name: /^Iron, symbol Fe/ }));
    const card = screen.getByRole('region', { name: 'Iron' });
    expect(within(card).getByText('7.874 g/cm³')).toBeTruthy();
    expect(within(card).getByText(/1,?811 K/)).toBeTruthy();
    expect(within(card).getByText('+2, +3')).toBeTruthy();
    expect(within(card).getByText('54, 56, 57, 58')).toBeTruthy();
  });

  it('moves between the f-block and the table with the arrow keys', async () => {
    renderUi(<ReferenceTool />);
    const barium = screen.getByRole('button', { name: /^Barium, symbol Ba/ });
    barium.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Lanthanum/);
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Actinium/);
  });

  it('filters by family and by search, keeping the shape of the table', async () => {
    renderUi(<ReferenceTool />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Family' }), 'Noble gas');
    expect(screen.getAllByRole('button', { name: /atomic number/ })).toHaveLength(7);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Family' }), 'All families');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search' }), 'zzz');
    expect(screen.getByRole('status').textContent).toContain('zzz');
  });

  it('inserts the facts about an element as a line of text', async () => {
    renderUi(<ReferenceTool />);
    await userEvent.click(screen.getByRole('button', { name: /^Iron, symbol Fe/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Insert the facts about Iron into the page' }));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatch(
      /^Fe \(Iron\), atomic number 26, atomic mass 55\.845 u, density 7\.874 g\/cm³, melts at 1,?811 K/,
    );
    expect(inserted[0]).toMatch(/electronegativity 1\.83, oxidation states \+2, \+3$/);
  });

  it('has a Units tab with searchable sections that insert', async () => {
    renderUi(<ReferenceTool />);
    await userEvent.click(screen.getByRole('tab', { name: 'Units' }));
    expect(screen.getByRole('heading', { name: 'SI base units' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fundamental constants (CODATA 2022)' })).toBeTruthy();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search' }), 'planck');
    expect(screen.queryByRole('heading', { name: 'Math formulas' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Insert Planck constant into the page' }));
    expect(inserted).toEqual(['h = 6.62607015 × 10⁻³⁴ J·s']);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search' }), 'quadratic');
    await userEvent.click(screen.getByRole('button', { name: 'Insert Quadratic formula into the page' }));
    expect(inserted[1]).toBe('x = (−b ± √(b² − 4ac)) / (2a)');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search' }), '');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Section' }), 'Physics formulas');
    expect(screen.queryByRole('heading', { name: 'Math formulas' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Physics formulas' })).toBeTruthy();
  });

  it('balances an equation and gives a molar mass on the Chemistry tab', async () => {
    renderUi(<ReferenceTool />);
    await userEvent.click(screen.getByRole('tab', { name: 'Chemistry' }));
    // The tab opens on water, balanced.
    expect(screen.getByText('Balanced: 2H₂ + O₂ → 2H₂O')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Insert the balanced equation into the page' }));
    const equation = screen.getByRole('textbox', { name: 'Equation' });
    await userEvent.fill(equation, 'C3H8 + O2 -> CO2 + H2O');
    expect(screen.getByText('Balanced: C₃H₈ + 5O₂ → 3CO₂ + 4H₂O')).toBeTruthy();
    await userEvent.fill(equation, 'H2 -> O2');
    expect(screen.getByText(/cannot be balanced/)).toBeTruthy();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Formula' }), 'H2O');
    expect(screen.getByText('Molar mass of H₂O = 18.015 g/mol')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Insert the molar mass into the page' }));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Formula' }), 'Xx');
    expect(screen.getByText(/not an element symbol/)).toBeTruthy();
    expect(inserted).toEqual(['2H₂ + O₂ → 2H₂O', 'Molar mass of H₂O = 18.015 g/mol']);
  });

  it('has no axe violations', async () => {
    const { container } = renderUi(<ReferenceTool />);
    await expectNoAxeViolations(container);
  });

  it('has no axe violations on the Units and Chemistry tabs', async () => {
    const { container } = renderUi(<ReferenceTool />);
    await userEvent.click(screen.getByRole('tab', { name: 'Units' }));
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('tab', { name: 'Chemistry' }));
    await expectNoAxeViolations(container);
  });
});
