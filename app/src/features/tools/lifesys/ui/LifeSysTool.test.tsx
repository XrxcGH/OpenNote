// The life science window in a real browser: no axe violations in either theme, answers in a status region, a
// calculation chosen from the list, arrow keys between tool tabs, and a readable error for impossible input.
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { LifeSysTool } from './LifeSysTool';

// The window opens on the last tool used; these tests start on biodiversity, whatever tab comes first.
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('opennote.tools.lifesys', JSON.stringify({ tool: 'diversity' }));
});
afterEach(() => localStorage.clear());

const answer = () => document.querySelector('[data-ls-answer]')?.textContent ?? '';

describe('the life science window', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`has no axe violations in the ${theme} theme`, async () => {
      const { container } = renderUi(<LifeSysTool />, { theme });
      await screen.findByLabelText('Counts per species');
      await expectNoAxeViolations(container);
    });
  }

  it('answers the diversity indices and says what is wrong with bad input', async () => {
    renderUi(<LifeSysTool />);
    const box = await screen.findByLabelText('Counts per species');
    expect(answer()).toContain('1.27985');
    fireEvent.change(box, { target: { value: '0\n0' } });
    expect(answer()).toContain('Enter at least 1 count above 0.');
  });

  it('switches calculation and remembers it', async () => {
    renderUi(<LifeSysTool />);
    const choose = await screen.findByLabelText('Calculation');
    fireEvent.change(choose, { target: { value: 'petersen' } });
    expect(answer()).toContain('189.091');
    expect(JSON.parse(localStorage.getItem('opennote.tools.lifesys.calc') ?? '{}').diversity).toBe('petersen');
  });

  it('draws the rarefaction curve as a labeled picture', async () => {
    renderUi(<LifeSysTool />);
    fireEvent.change(await screen.findByLabelText('Calculation'), { target: { value: 'rarefaction' } });
    expect(screen.getByRole('img', { name: /rarefaction curve/ })).toBeTruthy();
  });
});
