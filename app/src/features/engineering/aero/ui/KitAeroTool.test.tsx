// The aerospace window: tabs by keyboard, a live answer, units that switch, a problem in words, and Insert.
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../../tools';
import { KitAeroTool } from './KitAeroTool';

const inserted: { text?: string; table?: unknown; math?: unknown }[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<{ text?: string; handled: boolean }>).detail;
  inserted.push(detail);
  detail.handled = true;
};
beforeEach(() => window.addEventListener(INSERT_EVENT, listen));
afterEach(() => {
  window.removeEventListener(INSERT_EVENT, listen);
  inserted.splice(0);
  localStorage.clear();
});

describe('the aerospace window', () => {
  it('shows the standard atmosphere at 11 km, switches to US units, and says what is wrong', async () => {
    const { container } = renderUi(<KitAeroTool />);
    expect(await screen.findByText('216.65 K')).toBeTruthy();
    expect(screen.getByText('22632.1 Pa')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Atmosphere' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Answer line' }));
    expect(inserted[0]?.text).toContain('216.65 K');
    await userEvent.click(screen.getByRole('button', { name: 'Steps as a list' }));
    expect(inserted[1]?.text).toContain('<ol><li><p>');
    await userEvent.selectOptions(screen.getByLabelText('Units'), 'us');
    expect(await screen.findByText('389.97 °R')).toBeTruthy();
    expect((screen.getByLabelText('Altitude') as HTMLInputElement).value).toBe('36089.2');
    await userEvent.fill(screen.getByLabelText('Altitude'), '400000');
    expect(await screen.findByText(/covers −5 km to 86 km/)).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});
