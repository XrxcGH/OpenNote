// The state of one tool: what is typed in its fields and the unit chosen for each, remembered on this device, moved to
// the other unit system when the switch changes, and the answer computed from them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadStored, saveStored } from '../../ui/storage';
import { buildInput, parseNumber } from '../input';
import type { ToolSpec } from '../spec';
import type { Outcome } from '../types';
import { DIMS, convertFromBase, convertToBase, defaultUnit } from '../units';
import type { System, UnitDim } from '../units';
import { tr } from './text';

export interface Saved {
  values: Record<string, string>;
  units: Record<string, string>;
}

/** A typed number moved from one unit to another, as text; unreadable text stays as it is. */
export function moveUnit(text: string, dim: UnitDim, from: string, to: string): string {
  const n = parseNumber(text);
  if (n === null || Number.isNaN(n)) return text;
  return String(Number(convertFromBase(convertToBase(n, dim, from), dim, to).toPrecision(10)));
}

function initial(spec: ToolSpec, system: System): Saved {
  const saved = loadStored<Partial<Saved>>(`chemmat.${spec.id}`, {});
  const values: Record<string, string> = {};
  const units: Record<string, string> = {};
  for (const f of spec.fields) {
    const stored = saved.values?.[f.id];
    values[f.id] = typeof stored === 'string' ? stored : f.initial;
    if (!f.dim) continue;
    const unit = saved.units?.[f.id];
    units[f.id] = unit && DIMS[f.dim].units.some((u) => u.symbol === unit) ? unit : DIMS[f.dim].si;
    if (typeof stored !== 'string' && system === 'US') {
      // A field that was never typed in starts in the US unit with the same quantity.
      const us = DIMS[f.dim].us;
      values[f.id] = moveUnit(f.initial, f.dim, units[f.id], us);
      units[f.id] = us;
    }
  }
  return { values, units };
}

export function useToolState(spec: ToolSpec, system: System) {
  const [state, setState] = useState<Saved>(() => initial(spec, system));
  const first = useRef(true);

  // Switching the unit system moves each number to the new system's unit for that quantity.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState((prev) => {
      const units = { ...prev.units };
      const values = { ...prev.values };
      for (const f of spec.fields) {
        if (!f.dim) continue;
        const to = defaultUnit(f.dim, system);
        if (prev.units[f.id] === to) continue;
        values[f.id] = moveUnit(prev.values[f.id] ?? '', f.dim, prev.units[f.id], to);
        units[f.id] = to;
      }
      return { values, units };
    });
  }, [system, spec.fields]);

  useEffect(() => saveStored(`chemmat.${spec.id}`, state), [spec.id, state]);

  const outcome: Outcome = useMemo(() => {
    const built = buildInput(spec, state.values, state.units);
    if (!built.ok) return { ok: false, key: 'kitChemMat.err.number', vars: { name: tr(built.field) } };
    try {
      return spec.solve(built.input);
    } catch {
      return { ok: false, key: 'kitChemMat.err.unexpected' };
    }
  }, [spec, state]);

  const setValue = (id: string, next: string) =>
    setState((prev) => ({ ...prev, values: { ...prev.values, [id]: next } }));
  const setUnit = (id: string, dim: UnitDim, to: string) =>
    setState((prev) => ({
      values: { ...prev.values, [id]: moveUnit(prev.values[id] ?? '', dim, prev.units[id], to) },
      units: { ...prev.units, [id]: to },
    }));

  return { values: state.values, units: state.units, outcome, setValue, setUnit };
}
