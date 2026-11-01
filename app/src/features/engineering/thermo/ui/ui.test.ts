import '../text';
import { describe, expect, it } from 'vitest';
import { kitThermo } from '../../../../strings/en/kitThermo';
import type { ThermoResult } from '../common/types';
import { THERMO_LOADERS } from '../kit';
import { THERMO_TOOL_IDS } from '../meta';
import { fieldsOf, readNumber, switchSystem, textOf, valuesOf } from './formState';
import { linearTicks, logTicks, plotSvg, SCREEN_COLORS } from './plotSvg';
import { answerLine, resultTable, stateTable, stepsText, type Say } from './present';

// Words looked up the way t() does, without the app around it.
const say: Say = (key, vars = {}) => {
  const path = key.split('.').slice(1);
  let node: unknown = kitThermo;
  for (const part of path) node = (node as Record<string, unknown>)[part];
  if (typeof node !== 'string') throw new Error(`missing string ${key}`);
  return node.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
};

describe('form state', () => {
  it('reads numbers and simple math, and tells empty from wrong', () => {
    expect(readNumber('1.5e3')).toBe(1500);
    expect(readNumber('1,000')).toBe(1000);
    expect(readNumber('2*pi')).toBeCloseTo(2 * Math.PI, 12);
    expect(readNumber('')).toBeNull();
    expect(readNumber('abc')).toBeNaN();
  });

  it('keeps a typed value when the unit system changes', async () => {
    const { spec } = await THERMO_LOADERS.statthermo();
    const mode = spec.modes.find((one) => one.id === 'speeds')!;
    const form = { mode: 'speeds', text: { T: '300' }, unit: { T: 'K' } };
    const fields = fieldsOf(mode, form, 'SI');
    const us = switchSystem(form, fields, 'SI', 'US');
    expect(us.unit.T).toBe('°F');
    expect(Number(us.text.T)).toBeCloseTo(80.33, 2);
    const before = valuesOf(fields, form, 'SI').values.T as number;
    const after = valuesOf(fieldsOf(mode, us, 'US'), us, 'US').values.T as number;
    expect(after).toBeCloseTo(before, 3);
    expect(
      textOf(
        us,
        fields.find((f) => f.id === 'p')!,
        'US',
      ),
    ).toBe('14.6959');
  });

  it('marks a field that is not a number and one left empty', async () => {
    const { spec } = await THERMO_LOADERS.statthermo();
    const mode = spec.modes.find((one) => one.id === 'solid')!;
    const form = { mode: 'solid', text: { theta: 'x', T: '' }, unit: {} };
    const read = valuesOf(fieldsOf(mode, form, 'SI'), form, 'SI');
    expect(read.invalid).toEqual(['theta']);
    expect(read.empty).toEqual(['T']);
  });
});

describe('the answer line', () => {
  // The line names the tool's results, not the inputs that come first in the table.
  it.each([
    ['steam', 'state', ['v', 'h', 's']],
    ['r134a', 'state', ['v', 'h', 's']],
    ['psychro', 'air', ['omega', 'hMoist', 'twb']],
    ['combustion', 'complete', ['afrMass', 'flameT']],
    ['combustion', 'equilibrium', ['equivalenceRatio', 'flameT']],
    ['cycles', 'rankine', ['wNet', 'etaTh']],
    ['cycles', 'brayton', ['wNet', 'etaTh']],
  ] as const)('%s %s gives %j', async (id, modeId, keys) => {
    const { spec } = await THERMO_LOADERS[id]();
    const mode = spec.modes.find((one) => one.id === modeId)!;
    const form = { mode: mode.id, text: {}, unit: {} };
    const { values } = valuesOf(fieldsOf(mode, form, 'SI'), form, 'SI');
    const parts = answerLine(spec.solve(mode.id, values), 'SI', say).split('; ');
    expect(parts.map((part) => part.replace(/ -?[\d.].*$/, ''))).toEqual(
      keys.map((key) => (kitThermo.row as Record<string, string>)[key]),
    );
  });
});

describe('every tool works its first values and every string exists', () => {
  it.each(THERMO_TOOL_IDS)('%s', async (id) => {
    const { spec } = await THERMO_LOADERS[id]();
    for (const mode of spec.modes) {
      const form = { mode: mode.id, text: {}, unit: {} };
      for (const system of ['SI', 'US'] as const) {
        const fields = fieldsOf(mode, form, system);
        for (const field of fields) expect(kitThermo.field[field.label], field.label).toBeTruthy();
        const { values, invalid, empty } = valuesOf(fields, form, system);
        expect(invalid, `${id} ${mode.id}`).toEqual([]);
        expect(empty, `${id} ${mode.id}`).toEqual([]);
        const result: ThermoResult = spec.solve(mode.id, values);
        expect(result.rows.length).toBeGreaterThan(0);
        for (const row of result.rows) expect(Number.isFinite(row.value) || row.text !== undefined, row.key).toBe(true);
        expect(stepsText(result.steps, say)).not.toMatch(/\{\w+\}/);
        answerLine(result, system, say);
        resultTable(result, system, say);
        for (const note of result.notes) expect(kitThermo.note[note]).toBeTruthy();
        for (const plot of result.plots ?? []) {
          expect(kitThermo.plot[plot.title]).toBeTruthy();
          expect(plotSvg(plot, system, SCREEN_COLORS, 'plot')).toMatch(/^<svg[\s\S]*<\/svg>$/);
        }
        if (result.states) expect(stateTable(result.states, system).rows.length).toBe(result.states.length);
      }
    }
  });
});

describe('plot ticks', () => {
  it('uses round steps and powers of ten', () => {
    expect(linearTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(logTicks(0.5, 2000)).toEqual([1, 10, 100, 1000]);
  });
});
