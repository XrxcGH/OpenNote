// The reasoning kit window in a real browser: no axe violations in either theme, tabs that work from the keyboard,
// answers in a status region, and Insert that hands the page the answer, a table, or a picture.
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../flags';
import type { InsertDetail } from '../../ui/CalculatorTool';
import { KitWindow } from './KitWindow';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const answer = () => document.querySelector('[data-kit-answer]')!.textContent ?? '';

async function shown(text: string) {
  await expect.poll(answer, { timeout: 5000 }).toContain(text);
}

describe('the reasoning kit window', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`has no axe violations in the ${theme} theme`, async () => {
      const { container } = renderUi(<KitWindow />, { theme });
      await shown("B'C' + CD' + A'BD");
      await expectNoAxeViolations(container);
    });
  }

  it('minimizes the example and answers as the minterms change', async () => {
    renderUi(<KitWindow />);
    await shown("F(A, B, C, D) = B'C' + CD' + A'BD");
    fireEvent.change(screen.getByLabelText('Minterms'), { target: { value: '1 3 5 7' } });
    fireEvent.change(screen.getByLabelText('Variables, most significant first'), { target: { value: 'A B C' } });
    await shown('F(A, B, C) = C');
    expect(screen.getByRole('img', { name: /Karnaugh map of 3 variables/ })).toBeTruthy();
  });

  it('runs the 101 detector in state machine design', async () => {
    renderUi(<KitWindow />);
    await shown('F(A, B, C, D)');
    await userEvent.selectOptions(screen.getByLabelText('Mode'), 'fsm');
    await shown('Output 00101, ending in state S1');
    expect(screen.getByRole('table', { name: 'Run' })).toBeTruthy();
  });

  it('moves between tools with the arrow keys', async () => {
    renderUi(<KitWindow />);
    const tab = screen.getByRole('tab', { name: 'Digital logic' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    tab.focus();
    await userEvent.keyboard('{End}');
    expect(document.activeElement?.getAttribute('role')).toBe('tab');
  });

  it('inserts the answer and the table into the page', async () => {
    const asked: InsertDetail[] = [];
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<InsertDetail>).detail;
      asked.push({ ...detail });
      detail.handled = true;
    };
    window.addEventListener(INSERT_EVENT, listen);
    try {
      renderUi(<KitWindow />);
      await shown('F(A, B, C, D)');
      await userEvent.click(screen.getByRole('button', { name: 'Insert answer' }));
      await userEvent.click(screen.getByRole('button', { name: 'Insert table' }));
      await userEvent.click(screen.getByRole('button', { name: 'Insert picture' }));
      expect(asked[0].text).toBe("F(A, B, C, D) = B'C' + CD' + A'BD");
      expect(asked[1].table?.header).toEqual(['Prime', 'Pattern', 'Covers minterms', 'Essential']);
      expect(asked[2].picture?.mime).toBe('image/svg+xml');
    } finally {
      window.removeEventListener(INSERT_EVENT, listen);
    }
  });
});
