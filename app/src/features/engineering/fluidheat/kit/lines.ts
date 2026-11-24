// Reads a text field of one item per line, each line with the same number of quantities separated by commas or
// semicolons, such as "13600, -0.2". Quantities after the first `required` may be left out. A bare number is in the unit the kind shows in for the chosen system.
import { FluidHeatError, fail } from './types';
import { readQuantity, type Kind, type System } from './units';

export function readLines(text: string, kinds: readonly Kind[], system: System, required = kinds.length): number[][] {
  const rows: number[][] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    const parts = line.split(/[,;]/).map((part) => part.trim());
    if (parts.length < required || parts.length > kinds.length) fail('partsLine', String(index + 1));
    try {
      // A trailing number left out is 0.
      rows.push(kinds.map((kind, i) => (i < parts.length ? readQuantity(parts[i], kind, system) : 0)));
    } catch (error) {
      if (error instanceof FluidHeatError) fail('partsLine', String(index + 1));
      throw error;
    }
  });
  return rows;
}
