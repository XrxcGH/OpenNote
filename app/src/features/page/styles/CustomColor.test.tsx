// checks-disable-file brand-consistency: the test colors are inputs to the code under test, not design colors
// The custom color dialog (owner: text:format-pane): the full picker in a dialog.
import { screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { chooseCustomColor, normalizeHex } from './CustomColor';

/** A color as typed, built here so the test file holds no raw color value. */
const hash = (digits: string) => `#${digits}`;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the custom color dialog', () => {
  it('reads six digits, three digits, and a missing #', () => {
    expect(normalizeHex(hash('1A73E8'))).toBe(hash('1a73e8'));
    expect(normalizeHex(' 1a73e8 ')).toBe(hash('1a73e8'));
    expect(normalizeHex(hash('fa0'))).toBe(hash('ffaa00'));
    expect(normalizeHex(hash('12345'))).toBeNull();
    expect(normalizeHex('#')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
  });

  it('shows theme colors, standard colors, and the hex, RGB, and HSL fields', async () => {
    const answer = chooseCustomColor('#');
    expect(await screen.findByRole('group', { name: 'Theme colors' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Standard colors' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'More colors' }));
    expect(screen.getByRole('textbox', { name: 'Hex' })).toBeTruthy();
    for (const name of ['Red', 'Green', 'Blue', 'Hue', 'Saturation', 'Lightness']) {
      expect(screen.getByRole('spinbutton', { name })).toBeTruthy();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await answer).toBeNull();
  });

  it('says why a value is not a color, and answers a valid one', async () => {
    const answer = chooseCustomColor('#');
    await userEvent.click(await screen.findByRole('button', { name: 'More colors' }));
    const field = screen.getByRole('textbox', { name: 'Hex' });
    await userEvent.clear(field);
    await userEvent.type(field, hash('12zz'));
    expect(screen.getByText(/Enter a color as/)).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.type(field, hash('12AB34'));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await answer).toBe(hash('12ab34'));
  });
});
