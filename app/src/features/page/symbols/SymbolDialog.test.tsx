// The Symbol dialog through its interface: search by name, choose, and insert; the group list; the empty state.
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    const cell = await screen.findByRole('option', { name: 'rightwards arrow, U+2192' }, SLOW);
    expect(screen.getByRole('button', { name: 'Insert' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(cell);
    expect(cell.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ cp: 0x2192 }));
  });

  it('finds a character by its code, narrows by group, and says when nothing matches', async () => {
    render(<Picker done={vi.fn()} />);
    const box = await screen.findByRole('searchbox');
    fireEvent.change(box, { target: { value: '20AC' } });
    await screen.findByRole('option', { name: 'euro sign, U+20AC' }, SLOW);
    fireEvent.change(box, { target: { value: 'arrow' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'currency' } });
    await screen.findByText(/No symbol matches/);
    expect(screen.queryByRole('option', { name: /rightwards arrow/ })).toBeNull();
  });

  it('cancels with null', async () => {
    const done = vi.fn();
    render(<Picker done={done} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(done).toHaveBeenCalledWith(null);
  });

  it('is driven by the keyboard: one tab stop, arrows move, Enter inserts', async () => {
    const done = vi.fn<(entry: SymbolEntry | null) => void>();
    render(<Picker done={done} />);
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'arrow' } });
    await screen.findByRole('option', { name: 'rightwards arrow, U+2192' }, SLOW);
    const grid = screen.getByRole('listbox', { name: 'Symbols' });
    const options = within(grid).getAllByRole('option');
    expect(options.filter((o) => o.tabIndex === 0)).toHaveLength(1);
    options[0]?.focus();
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(options[1]);
    expect(options[1]?.tabIndex).toBe(0);
    expect(options[0]?.tabIndex).toBe(-1);
    fireEvent.keyDown(grid, { key: 'End' });
    expect(options.at(-1)?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(grid, { key: 'Home' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ char: options[0]?.textContent }));
  });

  it('lists the special characters and inserts one with a single press', async () => {
    const done = vi.fn<(entry: SymbolEntry | null) => void>();
    render(<Picker done={done} />);
    const group = await screen.findByRole('group', { name: 'Special characters' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Nonbreaking space, Ctrl+Shift+Space', 'Nonbreaking hyphen', 'Optional hyphen', 'Em dash', 'En dash']);
    fireEvent.click(within(group).getByRole('button', { name: 'Em dash' }));
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ cp: 0x2014 }));
  });
});
