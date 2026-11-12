// Settings, then Tables: a person chooses the keys new tables use (DESIGN.md section 11.1, PLAN.md decision 4).
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { navigate } from '../../../app/location';
import { getSettings } from '../../../state/settings';
import { disposeApp, expectNoAxeViolations, renderApp } from '../../../test';

afterEach(() => disposeApp());

describe('the Tables settings section', () => {
  it('lists Tables in the sections and sets the keys new tables use', async () => {
    await renderApp();
    navigate({ view: 'settings', section: 'tables' });
    const group = await screen.findByRole('radiogroup', { name: 'New tables use spreadsheet keys' });
    const spreadsheet = within(group).getByRole('radio', { name: /Spreadsheet keys/ });
    const document_ = within(group).getByRole('radio', { name: /Document keys/ });
    expect(spreadsheet.getAttribute('aria-checked')).toBe('true');
    expect(getSettings().tables.newTableKeys).toBe('spreadsheet');
    await userEvent.click(document_);
    await waitFor(() => expect(getSettings().tables.newTableKeys).toBe('document'));
    expect(document_.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(spreadsheet);
    await waitFor(() => expect(getSettings().tables.newTableKeys).toBe('spreadsheet'));
    await expectNoAxeViolations(document.body);
  });
});
