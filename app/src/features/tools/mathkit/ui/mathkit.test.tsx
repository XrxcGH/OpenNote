// The engineering mathematics window in a real browser: every tab opens on an answer with no problem showing, and each
// follows the theme with no axe violations.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { MATH_TOOLS } from '../meta';
import { MathKitTool } from './MathKitTool';
import { resetConsole } from '../matrixconsole/MatrixConsoleTool';
import { TOPICS } from '../numerics/NumericsTool';

beforeEach(() => {
  localStorage.clear();
  resetConsole();
});
afterEach(() => localStorage.clear());

const problem = () => document.querySelector('[role="alert"]')?.textContent ?? '';

describe('the engineering mathematics window', () => {
  for (const tool of MATH_TOOLS) {
    for (const theme of ['light', 'dark'] as const) {
      it(`${tool.id} opens on an answer and has no axe violations in the ${theme} theme`, async () => {
        const { container } = renderUi(<MathKitTool />, { theme });
        const tabs = screen.getAllByRole('tab');
        await userEvent.click(tabs[MATH_TOOLS.indexOf(tool)]);
        await waitFor(() => expect(container.querySelector('[aria-live="polite"], [role="log"]')).toBeTruthy());
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

  it('the console runs a typed command and shows its answer', async () => {
    renderUi(<MathKitTool />);
    await userEvent.click(screen.getAllByRole('tab')[MATH_TOOLS.findIndex((tool) => tool.id === 'console')]);
    const box = await screen.findByLabelText('Command or script');
    const enter = (text: string) => {
      fireEvent.change(box, { target: { value: text } });
      fireEvent.keyDown(box, { key: 'Enter' });
    };
    enter('A = [4 -2; 1 1]; det(A)');
    const log = screen.getByRole('log');
    await waitFor(() => expect(log.textContent).toContain('ans = 6'));
    enter('[1 2] * [3 4]');
    await waitFor(() => expect(log.textContent).toContain('Inner matrix dimensions must agree'));
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe('[1 2] * [3 4]'));
  });
});
