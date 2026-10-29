// The identification keys tool in the window: the key text from the starter table, running it to an end, the
// multi-access filter, and adding what was identified to the catalog.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { openKitTool, registerKit, resetKits } from '../../kits/registry';
import { KeysTool } from './KeysTool';

describe('identification keys tool', () => {
  it('prints the key and runs it to one taxon', async () => {
    const { container } = renderUi(<KeysTool />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dichotomous key' }));
    expect(screen.getByText('1a. Character 1: 1 . . . 2')).toBeTruthy();
    expect(screen.getByText('Every taxon is reached on its own.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '1b. Character 1: 0' }));
    fireEvent.click(screen.getByRole('button', { name: '3b. Character 2: 0' }));
    expect(screen.getByText('Identified as D.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add to catalog' }));
    expect(screen.getByRole('cell', { name: 'D' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('filters candidates with the multi-access key', () => {
    renderUi(<KeysTool />);
    fireEvent.click(screen.getByRole('tab', { name: 'Multi-access key' }));
    fireEvent.change(screen.getByLabelText('Character 2'), { target: { value: '0' } });
    expect(screen.getByText('B, D')).toBeTruthy();
  });

  it('reopens with the table a figure block saved', async () => {
    registerKit('humanities', () => undefined);
    await openKitTool('humanities', 'keys', { text: 'Taxon, a\nX, 1\nY, 0' });
    renderUi(<KeysTool />);
    expect(screen.getByText('2 taxa and 1 character.')).toBeTruthy();
    resetKits();
  });
});
