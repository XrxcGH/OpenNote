// Escape closes the meeting recap dialog (Beta 8 visual recheck: Escape did not close Copy the meeting recap).
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../../test';
import { openRecap } from './dialogs';

describe('the meeting recap dialog', () => {
  it('closes with Escape and gives focus back', async () => {
    await renderApp();
    const opener = document.body.appendChild(document.createElement('button'));
    opener.textContent = 'Opener';
    opener.focus();
    const closed = openRecap();
    await screen.findByRole('dialog', { name: 'Copy the meeting recap' });
    await userEvent.keyboard('{Escape}');
    await closed;
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Copy the meeting recap' })).toBeNull());
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
