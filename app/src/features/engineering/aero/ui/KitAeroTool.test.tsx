// The aerospace window: tabs by keyboard, a live answer, units that switch, a problem in words, and Insert.
import '../text';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { INSERT_EVENT, openKitTool, registerKit } from '../../../tools';
import { KitAeroTool } from './KitAeroTool';

const inserted: { text?: string; table?: unknown; math?: unknown; panel?: { data: { inputs: unknown } } }[] = [];
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

  it('shows the coordinates of a section and the stations of an engine, and inserts each as a table', async () => {
    const { container } = renderUi(<KitAeroTool />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Airfoil' }));
    expect(await screen.findByRole('table', { name: 'Coordinates per unit chord' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Coordinates per unit chord' }).tabIndex).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Insert this table' }));
    const table = inserted[0]?.table as { header: string[]; rows: string[][] } | undefined;
    expect(table?.header[0]).toBe('Station x/c');
    expect(table?.rows.length).toBe(18);
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('tab', { name: 'Jet engine' }));
    expect(await screen.findByRole('table', { name: 'Stations' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Total temperature Tt (K)' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('keeps the answer and the typed values as a live block, and Open in tool puts the values back', async () => {
    renderUi(<KitAeroTool />);
    await userEvent.fill(await screen.findByLabelText('Altitude'), '5000');
    expect(await screen.findByText(/255\.65 K/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Live calculation block' }));
    await waitFor(() => expect(inserted.find((one) => one.panel)).toBeTruthy());
    const inputs = inserted.find((one) => one.panel)!.panel!.data.inputs;
    await userEvent.fill(screen.getByLabelText('Altitude'), '11000');
    expect(await screen.findByText('216.65 K')).toBeTruthy();
    registerKit('aero', () => undefined);
    await openKitTool('aero', 'atmosphere', inputs);
    await waitFor(() => expect((screen.getByLabelText('Altitude') as HTMLInputElement).value).toBe('5000'));
  });
});
