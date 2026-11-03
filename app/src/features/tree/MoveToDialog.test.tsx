import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { chooseDestination } from './MoveToDialog';

describe('chooseDestination', () => {
  it('says Copy for Copy to, not Move (full walk A-A02-10)', async () => {
    void chooseDestination('Mitosis', [], 'copy');
    expect(await screen.findByRole('dialog', { name: 'Copy "Mitosis" to' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
    screen.getByRole('button', { name: 'Cancel' }).click();
  });
});
