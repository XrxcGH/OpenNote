// The reference tables show each element's group number and electron configuration, and insert them at the caret.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { INSERT_EVENT } from '../flags';
import { ReferenceTool } from './ReferenceTool';

const inserted: string[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<{ text?: string; handled: boolean }>).detail;
  if (detail.text !== undefined) inserted.push(detail.text);
  detail.handled = true;
};
window.addEventListener(INSERT_EVENT, listen);
afterEach(() => inserted.splice(0));

describe('the reference tables', () => {
  it('show the group number and electron configuration of an element', async () => {
    renderUi(<ReferenceTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search' }), 'iron');
    const row = screen.getByRole('row', { name: /Fe/ });
    expect(within(row).getByText('[Ar] 3d⁶ 4s²')).toBeTruthy();
    expect(within(row).getByText('8')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Electron configuration' })).toBeTruthy();
  });

  it('shows no group for an element of the f-block, and says so in words', async () => {
    renderUi(<ReferenceTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search' }), 'cerium');
    expect(within(screen.getByRole('row', { name: /Ce/ })).getByText('None')).toBeTruthy();
  });

  it('inserts the symbol, or the symbol with its configuration, at the caret', async () => {
    renderUi(<ReferenceTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Search' }), 'copper');
    await userEvent.click(screen.getByRole('button', { name: 'Insert Copper into the page' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Insert the electron configuration of Copper into the page' }),
    );
    expect(inserted).toEqual(['Cu', 'Cu: [Ar] 3d¹⁰ 4s¹']);
  });

  it('has no axe violations', async () => {
    const { container } = renderUi(<ReferenceTool />);
    await expectNoAxeViolations(container);
  });
});
