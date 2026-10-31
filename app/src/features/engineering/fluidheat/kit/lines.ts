// Reads a text field of one item per line, each line with the same number of quantities separated by commas or
// semicolons, such as "13600, -0.2". A bare number is in the unit the kind shows in for the chosen system.
import { FluidHeatError, fail } from './types';
import { readQuantity, type Kind, type System } from './units';

export function readLines(text: string, kinds: readonly Kind[], system: System): number[][] {
  const rows: number[][] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    const parts = line.split(/[,;]/).map((part) => part.trim());
    if (parts.length !== kinds.length) fail('partsLine', String(index + 1));
    try {
      rows.push(parts.map((part, i) => readQuantity(part, kinds[i], system)));
    } catch (error) {
      if (error instanceof FluidHeatError) fail('partsLine', String(index + 1));
      throw error;
    }
  });
  return rows;
}
