import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../services/notes';
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

describe('the destination list', () => {
  it('has touch-size options in touch density (W9-VB-5)', async () => {
    document.documentElement.setAttribute('data-density', 'touch');
    try {
      const places = [
        { id: 'n1' as NodeId, kind: 'notebook' as const, title: 'Biology 101', path: 'Biology 101', depth: 0 },
      ];
      void chooseDestination('Mitosis', places, 'move');
      const option = await screen.findByRole('option', { name: /Biology 101/ });
      expect(option.offsetHeight).toBeGreaterThanOrEqual(44);
      screen.getByRole('button', { name: 'Cancel' }).click();
    } finally {
      document.documentElement.removeAttribute('data-density');
    }
  });
});
