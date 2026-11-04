import { act, fireEvent, screen } from '@testing-library/react';
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

  it('stays open and says why when the color is not one', async () => {
    const answer = chooseCustomColor('#');
    const field = await screen.findByLabelText(/Custom color/);
    fireEvent.change(field, { target: { value: hash('12zz') } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not a color/);
    expect(screen.getByLabelText(/Custom color/).getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(screen.getByLabelText(/Custom color/), { target: { value: hash('12AB34') } });
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    });
    expect(await answer).toBe(hash('12ab34'));
  });
});
