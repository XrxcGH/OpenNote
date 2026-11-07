// The unit converter: swap the two units, and copy the conversion.
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../test';
import { ConverterTool } from './ConverterTool';

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Nothing saved.
  }
});

describe('the unit converter', () => {
  it('swaps the units and keeps the converted value, so a second swap comes back', async () => {
    renderUi(<ConverterTool />);
    const units = () => screen.getAllByRole('combobox').slice(1) as HTMLSelectElement[];
    expect(units().map((one) => one.value)).toEqual(['mi', 'km']);
    await userEvent.click(screen.getByRole('button', { name: 'Swap units' }));
    expect(units().map((one) => one.value)).toEqual(['km', 'mi']);
    const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(Number(boxes()[0].value)).toBeCloseTo(1.609344, 5);
    await userEvent.click(screen.getByRole('button', { name: 'Swap units' }));
    expect(units().map((one) => one.value)).toEqual(['mi', 'km']);
    expect(Number(boxes()[0].value)).toBeCloseTo(1, 5);
  });

  it('copies the conversion to the clipboard', async () => {
    const written: string[] = [];
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockImplementation((text) => {
      written.push(text);
      return Promise.resolve();
    });
    renderUi(<ConverterTool />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy result' }));
    expect(written[0]).toMatch(/^1 mi = 1\.609\d* km$/);
    clipboard.mockRestore();
  });
});
