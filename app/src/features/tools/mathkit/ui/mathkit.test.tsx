// The engineering mathematics window in a real browser: every tab opens on an answer with no problem showing, and each
// follows the theme with no axe violations.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { MATH_TOOLS } from '../meta';
import { MathKitTool } from './MathKitTool';
import { TOPICS } from '../numerics/NumericsTool';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const problem = () => document.querySelector('[role="alert"]')?.textContent ?? '';

describe('the engineering mathematics window', () => {
  for (const tool of MATH_TOOLS) {
    for (const theme of ['light', 'dark'] as const) {
      it(`${tool.id} opens on an answer and has no axe violations in the ${theme} theme`, async () => {
        const { container } = renderUi(<MathKitTool />, { theme });
        const tabs = screen.getAllByRole('tab');
        await userEvent.click(tabs[MATH_TOOLS.indexOf(tool)]);
        await waitFor(() => expect(container.querySelector('[aria-live="polite"]')).toBeTruthy());
        expect(problem()).toBe('');
        await expectNoAxeViolations(container);
      });
    }
  }

  for (const topic of TOPICS) {
    it(`numerical methods: ${topic} gives an answer`, async () => {
      const { container } = renderUi(<MathKitTool />);
      await userEvent.click(screen.getAllByRole('tab')[MATH_TOOLS.findIndex((tool) => tool.id === 'numerics')]);
      const select = await screen.findByLabelText('Kind of method');
      fireEvent.change(select, { target: { value: topic } });
      await waitFor(() => expect(container.querySelector('[aria-live="polite"]')?.textContent).toBeTruthy());
      expect(problem()).toBe('');
    });
  }
});
