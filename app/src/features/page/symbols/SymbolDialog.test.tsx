// The Symbol dialog through its interface: search by name, choose, and insert; the group list; the empty state.
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Picker } from './SymbolDialog';
import type { SymbolEntry } from './model';

const SLOW = { timeout: 15_000 };

afterEach(() => localStorage.clear());

describe('the Symbol dialog', () => {
  it('finds RIGHTWARDS ARROW by name and inserts it', async () => {
    const done = vi.fn<(entry: SymbolEntry | null) => void>();
    render(<Picker done={done} />);
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'arrow' } });
    const cell = await screen.findByRole('button', { name: 'rightwards arrow, U+2192' }, SLOW);
    expect(screen.getByRole('button', { name: 'Insert' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(cell);
    expect(cell.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ cp: 0x2192 }));
  });

  it('finds a character by its code, narrows by group, and says when nothing matches', async () => {
    render(<Picker done={vi.fn()} />);
    const box = await screen.findByRole('searchbox');
    fireEvent.change(box, { target: { value: '20AC' } });
    await screen.findByRole('button', { name: 'euro sign, U+20AC' }, SLOW);
    fireEvent.change(box, { target: { value: 'arrow' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'currency' } });
    await screen.findByText(/No symbol matches/);
    expect(screen.queryByRole('button', { name: /rightwards arrow/ })).toBeNull();
  });

  it('cancels with null', async () => {
    const done = vi.fn();
    render(<Picker done={done} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(done).toHaveBeenCalledWith(null);
  });
});
