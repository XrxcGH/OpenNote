// The science helpers' windows: the constants picker, Insert LaTeX, and the significant-figures helper.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { INSERT_EVENT } from '../flags';
import { ConstantsTool } from './ConstantsTool';
import { LatexTool, convertPaste } from './LatexTool';
import { SigFigsTool, shapeNumber } from './SigFigsTool';

interface Detail {
  text?: string;
  math?: { source: string; display: boolean };
  handled: boolean;
}
const inserted: Detail[] = [];
window.addEventListener(INSERT_EVENT, (event) => {
  const detail = (event as CustomEvent<Detail>).detail;
  inserted.push({ ...detail });
  detail.handled = true;
});
afterEach(() => {
  inserted.splice(0);
  try {
    localStorage.clear();
  } catch {
    // Nothing to clear.
  }
});

describe('the constants picker', () => {
  it('searches, and inserts the symbol, the value, or both as text', async () => {
    renderUi(<ConstantsTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search constants' }), 'planck');
    expect(screen.getByText('Planck constant')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Insert the symbol of Planck constant' }));
    await userEvent.click(screen.getByRole('button', { name: 'Insert the value of Planck constant' }));
    await userEvent.click(screen.getByRole('button', { name: 'Insert the symbol and value of Planck constant' }));
    expect(inserted.map((one) => one.text)).toEqual(['h', '6.62607015×10⁻³⁴ J s', 'h = 6.62607015×10⁻³⁴ J s']);
  });

  it('inserts an equation when asked to, and shows the uncertainty and the calculator name', async () => {
    renderUi(<ConstantsTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search constants' }), 'gravitation');
    expect(screen.getByText('6.67430(15)×10⁻¹¹')).toBeTruthy();
    expect(screen.getByText(/In Math with variables and units, and in the calculator, write G/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Insert the symbol and value of Newtonian constant of gravitation' }),
    );
    expect(inserted[0].math).toEqual({
      source: 'G = 6.67430(15)\\times10^{-11}\\,\\mathrm{m^{3}\\,kg^{-1}\\,s^{-2}}',
      display: false,
    });
  });

  it('says when nothing matches, filters by group, and passes an accessibility check', async () => {
    const { container } = renderUi(<ConstantsTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search constants' }), 'zzz');
    expect(
      screen
        .getAllByRole('status')
        .map((one) => one.textContent)
        .join(' '),
    ).toContain('No constant matches "zzz".');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search constants' }), '');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Group' }), 'Atomic and nuclear');
    const rows = within(screen.getByRole('table', { name: 'Constants' })).getAllByRole('row');
    expect(rows.length).toBeGreaterThan(3);
    await expectNoAxeViolations(container);
  });
});

describe('Insert LaTeX', () => {
  it('shows a live preview and inserts in the line or on its own line', async () => {
    const { container } = renderUi(<LatexTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'LaTeX' }), 'x^2 + y^2');
    await expect.poll(() => container.querySelector('.katex') !== null, { timeout: 20_000 }).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Insert equation' }));
    await userEvent.click(screen.getByRole('button', { name: 'On its own line' }));
    await userEvent.click(screen.getByRole('button', { name: 'Insert equation' }));
    expect(inserted.map((one) => one.math)).toEqual([
      { source: 'x^2 + y^2', display: false },
      { source: 'x^2 + y^2', display: true },
    ]);
    await expectNoAxeViolations(container);
  });

  it('puts a snippet in the field and leaves its first gap selected', async () => {
    renderUi(<LatexTool />);
    await userEvent.click(screen.getByRole('button', { name: 'Fraction' }));
    const field = screen.getByRole('textbox', { name: 'LaTeX' }) as HTMLTextAreaElement;
    expect(field.value).toBe('\\frac{▢}{▢}');
    expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe('▢');
    await userEvent.click(screen.getByRole('tab', { name: 'Greek' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pi' }));
    expect(field.value).toContain('\\pi');
  });

  it('reports a LaTeX problem in words', async () => {
    renderUi(<LatexTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'LaTeX' }), '\\frac{1');
    await expect
      .poll(() => screen.queryByRole('alert')?.textContent ?? '', { timeout: 20_000 })
      .toContain('LaTeX problem');
  });

  it('turns pasted marks into a shape', () => {
    expect(convertPaste('$$a^2$$')).toEqual({ source: 'a^2', display: true });
    expect(convertPaste('\\(a^2\\)')).toEqual({ source: 'a^2', display: false });
    expect(convertPaste('plain words')).toBeNull();
    expect(convertPaste('so $a$ and $b$')).toBeNull();
  });
});

describe('the significant-figures helper', () => {
  it('counts figures, warns about unclear zeros, and rounds', async () => {
    const { container } = renderUi(<SigFigsTool />);
    const number = screen.getByRole('textbox', { name: 'Number' });
    await userEvent.fill(number, '0.00120');
    expect(screen.getByText('3 significant figures')).toBeTruthy();
    await userEvent.fill(number, '1200');
    expect(screen.getByText('2 significant figures')).toBeTruthy();
    expect(screen.getByText(/1\.2×10³ to make the count clear/)).toBeTruthy();
    await userEvent.fill(screen.getByRole('spinbutton', { name: 'Round to this many figures' }), '1');
    expect(screen.getByText('1000')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Scientific' }));
    expect(screen.getByText('1×10³')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('calculates by the rules and says which rule it used', async () => {
    renderUi(<SigFigsTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Calculate with significant figures' }), '12.11 + 0.3');
    expect(screen.getByText('12.4')).toBeTruthy();
    expect(screen.getByText(/Adding and subtracting: .* decimal places .* fewest/)).toBeTruthy();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Calculate with significant figures' }), '2.50 * 3.1');
    expect(screen.getByText('7.8')).toBeTruthy();
    expect(screen.getByText(/Multiplying and dividing: .* significant figures .* fewest/)).toBeTruthy();
  });

  it('inserts the shaped number at the caret', async () => {
    renderUi(<SigFigsTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Number' }), '3.14159');
    await userEvent.fill(screen.getByRole('spinbutton', { name: 'Round to this many figures' }), '3');
    await userEvent.click(screen.getAllByRole('button', { name: 'Insert result' })[0]);
    expect(inserted[0].text).toBe('3.14');
    expect(shapeNumber('3.14159', '3', 'plain')).toBe('3.14');
    expect(shapeNumber('x', '3', 'plain')).toBeNull();
  });
});
