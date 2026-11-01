// The Chemistry and materials window in a real browser: tabs can be switched and the window reopened with worked steps
// drawn by KaTeX, and a narrow window offers a menu in place of the wrapping tab strip.
import './text';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { KitWindow } from './KitWindow';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const steps = async (container: HTMLElement) => {
  await expect.poll(() => container.querySelectorAll('.katex').length, { timeout: 8000 }).toBeGreaterThan(0);
};

describe('the chemistry and materials window', () => {
  it('draws steps with KaTeX after switching tabs twice and after reopening', async () => {
    const first = renderUi(<KitWindow />);
    await steps(first.container);
    await userEvent.click(screen.getByRole('tab', { name: /Crystal/ }));
    await steps(first.container);
    await userEvent.click(screen.getByRole('tab', { name: /diffusion/i }));
    await steps(first.container);
    first.unmount();
    const again = renderUi(<KitWindow />);
    await steps(again.container);
    expect(again.container.textContent).not.toContain('Cannot read');
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`has no axe violations in the ${theme} theme`, async () => {
      const { container } = renderUi(<KitWindow />, { theme });
      await expectNoAxeViolations(container);
    });
  }

  it('shows a tool menu instead of the tab strip in a narrow window', async () => {
    const { container } = renderUi(
      <div style={{ inlineSize: '420px' }}>
        <KitWindow />
      </div>,
    );
    const menu = within(container).getByRole('combobox', { name: /Chemistry/ });
    expect(getComputedStyle(menu.closest('label')!).display).not.toBe('none');
    expect(getComputedStyle(within(container).getByRole('tablist', { hidden: true })).display).toBe('none');
    await userEvent.selectOptions(menu, menu.querySelectorAll('option')[2] as HTMLOptionElement);
    await steps(container);
  });
});
