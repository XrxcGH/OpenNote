// Reads what was typed in a tool's fields into the solver's input, in base units.
import type { MessageKey } from '../../../strings/t';
import type { Input, ToolSpec } from './spec';
import { convertToBase, defaultUnit } from './units';

/** A number typed in a field: null when empty, NaN when it is not a number. Accepts commas and 1.2 x 10^5. */
export function parseNumber(text: string): number | null {
  const raw = text
    .trim()
    .replace(/,/g, '')
    .replace(/\s*[×x]\s*10\^?/i, 'e')
    .replace(/−/g, '-');
  if (raw === '') return null;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(raw) ? Number(raw) : NaN;
}

/** Turns the typed fields into the solver's input, or says which field is wrong. */
export function buildInput(
  spec: ToolSpec,
  values: Record<string, string>,
  units: Record<string, string>,
): { ok: true; input: Input } | { ok: false; field: MessageKey } {
  const input: Input = {};
  for (const field of spec.fields) {
    if (field.when && !field.when(values)) continue;
    const text = values[field.id] ?? field.initial;
    if (field.kind !== 'number') {
      input[field.id] = text;
      continue;
    }
    const n = parseNumber(text);
    if (n === null) {
      if (field.optional) {
        input[field.id] = NaN;
        continue;
      }
      return { ok: false, field: field.label };
    }
    if (Number.isNaN(n)) return { ok: false, field: field.label };
    input[field.id] = field.dim ? convertToBase(n, field.dim, units[field.id] ?? defaultUnit(field.dim, 'SI')) : n;
  }
  return { ok: true, input };
}
