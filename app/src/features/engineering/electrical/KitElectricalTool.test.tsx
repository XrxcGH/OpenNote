// The circuits and energy window: tabs, a live answer, a problem in words, and Insert into the page.
import './text';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { INSERT_EVENT } from '../../tools';
import { KitElectricalTool } from './KitElectricalTool';

const inserted: string[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<{ text?: string; handled: boolean }>).detail;
  if (detail.text !== undefined) inserted.push(detail.text);
  detail.handled = true;
};
beforeEach(() => window.addEventListener(INSERT_EVENT, listen));
afterEach(() => {
  window.removeEventListener(INSERT_EVENT, listen);
  inserted.splice(0);
  localStorage.clear();
});

describe('the circuits and energy window', () => {
  it('shows the worked example, inserts the answer, and says what is wrong with an input', async () => {
    const { container } = renderUi(<KitElectricalTool />);
    expect(await screen.findByText('3.6276 ms')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Transients' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Answer line' }));
    expect(inserted[0]).toContain('11.63');
    await userEvent.fill(screen.getByLabelText('Resistance R (Ω)'), 'abc');
    expect((await screen.findByRole('alert')).textContent).toContain('Resistance R (Ω) needs a number');
    await userEvent.fill(screen.getByLabelText('Resistance R (Ω)'), '100');
    await expectNoAxeViolations(container);
  });
});
