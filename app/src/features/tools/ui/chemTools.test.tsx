// The chemistry and property windows in a real browser: each follows the theme with no axe violations, answers in
// words, and keeps its picture or table readable to a screen reader.
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { ChemCalcTool } from './ChemCalcTool';
import { PropertiesTool } from './PropertiesTool';
import { StructureTool } from './StructureTool';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('the chemistry calculators', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`have no axe violations in the ${theme} theme`, async () => {
      const { container } = renderUi(<ChemCalcTool />, { theme });
      await expectNoAxeViolations(container);
    });
  }

  it('balance an equation and say the answer in a status region', () => {
    renderUi(<ChemCalcTool />);
    const status = document.querySelector('[data-chem-answer]')!;
    expect(status.textContent).toContain('C3H8 + 5O2 → 3CO2 + 4H2O');
    const box = screen.getByLabelText('Equation');
    fireEvent.change(box, { target: { value: 'H2 + O2' } });
    expect(status.textContent).toContain('arrow');
  });

  it('solve the ideal gas law for the empty box', async () => {
    renderUi(<ChemCalcTool />);
    await userEvent.click(screen.getByRole('tab', { name: 'Gas laws' }));
    const status = document.querySelector('[data-chem-answer]')!;
    expect(status.textContent).toContain('Volume = 22.41 L');
  });

  it('show the titration curve as a labeled picture', async () => {
    renderUi(<ChemCalcTool />);
    await userEvent.click(screen.getByRole('tab', { name: 'Titration' }));
    expect(screen.getByRole('img', { name: /Titration curve: pH starts at 2\.9/ })).toBeTruthy();
    expect(document.querySelector('[data-chem-answer]')!.textContent).toContain('Equivalence at 25 mL, pH 8.72');
  });
});

describe('the structure window', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`has no axe violations in the ${theme} theme`, async () => {
      const { container } = renderUi(<StructureTool />, { theme });
      await expectNoAxeViolations(container);
    });
  }

  it('draws a structure with a name, a formula, and an error in words', () => {
    renderUi(<StructureTool />);
    expect(screen.getByRole('img', { name: /Skeletal formula/ })).toBeTruthy();
    expect(screen.getByText(/C9H8O4 · 180\.16 g\/mol/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Structure as SMILES text'), { target: { value: 'C(C' } });
    expect(screen.getByText('A bracket ( ) does not match.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Put on page as ink' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('the property tables', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`have no axe violations in the ${theme} theme`, async () => {
      const { container } = renderUi(<PropertiesTool />, { theme });
      await expectNoAxeViolations(container);
    });
  }

  it('read steam at a temperature and search materials', async () => {
    renderUi(<PropertiesTool />);
    expect(screen.getByRole('region', { name: 'Saturated steam table' })).toBeTruthy();
    expect(screen.getByText(/100 °C · 101\.42 kPa/)).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Materials' }));
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '6061' } });
    const table = screen.getByRole('region', { name: 'Materials table' });
    expect(within(table).getByText(/Aluminum 6061/)).toBeTruthy();
    expect(within(table).getAllByRole('row').length).toBe(2);
  });
});
