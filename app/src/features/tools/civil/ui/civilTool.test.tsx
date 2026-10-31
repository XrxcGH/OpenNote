// The civil engineering kit window in a real browser: no axe violations in either theme, an answer in a status
// region that follows the fields, a named problem for bad input, and Insert that hands the page the answer.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../flags';
import { choose } from '../selection';
import { CivilTool } from './CivilTool';

const answer = () => document.querySelector('[data-civil-answer]')!;

beforeEach(() => {
  localStorage.clear();
  choose('groundwater', 'darcy');
});
afterEach(() => localStorage.clear());

describe('the civil engineering kit', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`has no axe violations in the ${theme} theme`, async () => {
      const { container } = renderUi(<CivilTool />, { theme });
      await screen.findByLabelText('Hydraulic conductivity K');
      await expectNoAxeViolations(container);
    });
  }

  it('answers as the fields change, and names the field that needs a number', async () => {
    renderUi(<CivilTool />);
    const K = await screen.findByLabelText('Hydraulic conductivity K');
    await waitFor(() => expect(answer().textContent).toContain('The Darcy flux is 1 × 10⁻⁶ m/s'));
    fireEvent.change(K, { target: { value: 'abc' } });
    await waitFor(() => expect(answer().textContent).toContain('Hydraulic conductivity K needs a number'));
    expect(K.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(screen.getByRole('combobox', { name: 'Unit for Hydraulic conductivity K' }), {
      target: { value: 'cm/s' },
    });
    fireEvent.change(K, { target: { value: '0.01' } });
    await waitFor(() => expect(answer().textContent).toContain('The Darcy flux is 1 × 10⁻⁶ m/s'));
  });

  it('switches calculations and draws a labeled plot', async () => {
    renderUi(<CivilTool />);
    await screen.findByLabelText('Hydraulic conductivity K');
    fireEvent.change(screen.getByLabelText('Calculation'), { target: { value: 'transient' } });
    await waitFor(() => expect(answer().textContent).toContain('The drawdown is 3.21328 m.'));
    expect(screen.getByRole('img', { name: /Drawdown over time/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Worked steps' })).toBeTruthy();
  });

  it('inserts the answer into the page', async () => {
    const seen: string[] = [];
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; handled: boolean }>).detail;
      if (detail.text) seen.push(detail.text);
      detail.handled = true;
    };
    window.addEventListener(INSERT_EVENT, listener);
    try {
      renderUi(<CivilTool />);
      await screen.findByLabelText('Hydraulic conductivity K');
      fireEvent.click(screen.getByRole('button', { name: 'Insert answer' }));
      await waitFor(() => expect(seen[0]).toContain('The Darcy flux is'));
    } finally {
      window.removeEventListener(INSERT_EVENT, listener);
    }
  });
});
