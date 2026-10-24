import { describe, expect, it } from 'vitest';
import { en } from '../../../../strings/en';
import { SOLIDS_TOOLS } from '../meta';
import { SPECS } from '../specs';
import { fillMath, numberLatex, numberText, valueText } from './format';
import { argMax, brent, gauss3, symmetricEigen } from './numeric';
import { PAGE, plotSvg } from './picture';
import { firstTexts, pinUnits, readValues, runTool } from './read';
import type { ToolSpec } from './spec';
import { SolidsError, q } from './types';
import { readQuantity } from './units';

const close = (a: number, b: number, rel = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));

describe('reading quantities', () => {
  it('reads a bare number in the system unit and a typed unit in its own', () => {
    close(readQuantity('25', 'length', 'si'), 0.025);
    close(readQuantity('1', 'length', 'us'), 0.0254);
    close(readQuantity('2 in', 'length', 'si'), 0.0508);
    close(readQuantity('200 GPa', 'modulus', 'us'), 200e9);
    close(readQuantity('1 kN·m', 'moment', 'si'), 1000);
    close(readQuantity('1 kN m', 'moment', 'si'), 1000);
    close(readQuantity('8e6 mm^4', 'inertia', 'si'), 8e-6);
    close(readQuantity('2*pi rad/s', 'angularSpeed', 'si'), 2 * Math.PI);
    close(readQuantity('30', 'angle', 'si'), Math.PI / 6);
    close(readQuantity('500 µε', 'strain', 'si'), 5e-4);
    close(readQuantity('9 °F', 'tempChange', 'si'), 5);
    close(readQuantity('29000 ksi', 'modulus', 'si'), 29000 * 6894757.293168361);
  });

  it('reads a degree or percent sign once', () => {
    for (const text of ['30°', '30 °', '30 deg', '30']) close(readQuantity(text, 'angle', 'si'), Math.PI / 6);
    close(readQuantity('30°', 'angle', 'us'), 0.5235987755982988);
    close(readQuantity('0.2 %', 'strain', 'si'), 0.002);
    close(readQuantity('20%', 'percent', 'si'), 0.2);
    expect(() => readQuantity('30°', 'length', 'si')).toThrow(SolidsError);
    // An angle pinned on a change of system reads the same.
    const spec: ToolSpec = {
      fields: [{ id: 'a', type: 'quantity', kind: 'angle', first: '30' }],
      run: () => ({ rows: [], steps: [] }),
    };
    expect(pinUnits(spec, { a: '30' }, 'si').a).toBe('30 deg');
    expect(pinUnits(spec, { a: '30°' }, 'si').a).toBe('30°');
    close(readValues(spec, pinUnits(spec, { a: '30' }, 'si'), 'us').values.a as number, Math.PI / 6);
  });

  it('turns radians into turns for rpm and Hz fields, and turns into radians for rad/s fields', () => {
    // 157.08 rad/s is 1500 rpm, 25 rev/s; 6.283 rad/s is 1 Hz.
    close(readQuantity('157.0796327 rad/s', 'speed', 'si'), 25, 1e-8);
    close(readQuantity('2*pi rad/s', 'frequency', 'si'), 1);
    close(readQuantity('1500 rpm', 'angularSpeed', 'si'), 50 * Math.PI);
    close(readQuantity('1 Hz', 'angularSpeed', 'si'), 2 * Math.PI);
    close(readQuantity('1500 rpm', 'speed', 'si'), 25);
  });

  it('reads 1/X units, Msi, and absolute temperatures', () => {
    close(readQuantity('12e-6 1/K', 'expansion', 'si'), 12e-6);
    close(readQuantity('6.5e-6 1/°F', 'expansion', 'si'), 6.5e-6 * 1.8);
    close(readQuantity('0.002 1/mm', 'curvature', 'si'), 2);
    close(readQuantity('29 Msi', 'modulus', 'si'), 29e6 * 6894.757293168361);
    close(readQuantity('29', 'modulus', 'us'), 29e6 * 6894.757293168361);
    close(readQuantity('100 lbf/in', 'lineLoad', 'si'), (100 * 4.4482216152605) / 0.0254);
    // 212 °F is 100 °C is 373.15 K, whichever way it is typed; a bare number is °C in SI and °F in US.
    close(readQuantity('212 degF', 'temperature', 'si'), 373.15);
    close(readQuantity('100 degC', 'temperature', 'us'), 373.15);
    close(readQuantity('373.15 K', 'temperature', 'si'), 373.15);
    close(readQuantity('100', 'temperature', 'si'), 373.15);
    close(readQuantity('32', 'temperature', 'us'), 273.15);
    // A difference keeps no offset.
    close(readQuantity('18 degF', 'tempChange', 'si'), 10);
  });

  it('names both units when a typed unit measures something else', () => {
    try {
      readQuantity('5 kN', 'length', 'si');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SolidsError);
      expect((error as SolidsError).code).toBe('unitMismatch');
      expect((error as SolidsError).detail).toBe('kN|mm');
    }
  });

  it('says when a field is empty or cannot be read', () => {
    expect(() => readQuantity('', 'length', 'si')).toThrow('empty');
    expect(() => readQuantity('abc', 'length', 'si')).toThrow('unreadable');
    expect(() => readQuantity('5 furlongs', 'length', 'si')).toThrow('unreadable');
    expect(() => readQuantity('1/0', 'length', 'si')).toThrow('unreadable');
  });
});

describe('formatting', () => {
  it('writes five significant figures and a power of ten for large and small values', () => {
    expect(numberText(85)).toBe('85');
    expect(numberText(-45)).toBe('−45');
    expect(numberText(5333333.33)).toBe('5.3333×10⁶');
    expect(numberText(0.0001234)).toBe('1.234×10⁻⁴');
    expect(numberText(0)).toBe('0');
    expect(numberText(NaN)).toBe('—');
    expect(numberLatex(5333333.33)).toBe('5.3333 \\times 10^{6}');
    expect(numberText(999999.9)).toBe('1×10⁶');
  });

  it('writes a quantity in the chosen system and fills an equation', () => {
    expect(valueText(q(85e6, 'stress'), 'si')).toBe('85 MPa');
    expect(valueText(q(6894757.293168361, 'stress'), 'us')).toBe('1 ksi');
    expect(valueText(q(Math.PI / 4, 'angle'), 'si')).toBe('45°');
    expect(fillMath('x = [[a]]', { a: q(0.025, 'length') }, 'si')).toBe('x = 25\\,\\mathrm{mm}');
  });
});

describe('numerical methods', () => {
  it('finds roots, maxima, eigenvalues, and integrals', () => {
    close(brent((x) => x * x - 2, 0, 2) ?? NaN, Math.SQRT2, 1e-12);
    expect(brent((x) => x * x + 1, 0, 2)).toBeNull();
    close(
      argMax((x) => -((x - 0.3) ** 2), 0, 1),
      0.3,
      1e-8,
    );
    const { values, vectors } = symmetricEigen([
      [2, 1],
      [1, 2],
    ]);
    close(values[0], 3);
    close(values[1], 1);
    close(Math.abs(vectors[0][0]), Math.SQRT1_2);
    close(
      gauss3((x) => x ** 5 - 3 * x ** 2, 0, 2),
      64 / 6 - 8,
    );
  });
});

describe('reading a tool', () => {
  const spec: ToolSpec = {
    fields: [
      { id: 'mode', type: 'choice', options: ['a', 'b'], first: 'a' },
      { id: 'L', type: 'quantity', kind: 'length', first: '100 mm' },
      { id: 'x', type: 'quantity', kind: 'length', first: '', optional: true, when: (v) => v.mode === 'b' },
    ],
    run: (values) => ({ rows: [{ id: 'L', value: q(values.L as number, 'length') }], steps: [] }),
  };

  it('reads the shown fields and keeps the values when the system changes', () => {
    const texts = { ...firstTexts(spec), L: '100' };
    close(readValues(spec, texts, 'si').values.L as number, 0.1);
    const pinned = pinUnits(spec, texts, 'si');
    expect(pinned.L).toBe('100 mm');
    close(readValues(spec, pinned, 'us').values.L as number, 0.1);
  });

  it('marks a field that cannot be read and does not run', () => {
    const run = runTool(spec, { mode: 'b', L: '5 kN', x: '' }, 'si');
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.fields.map((one) => one.field)).toEqual(['L']);
  });
});

describe('every tool', () => {
  const messages = en.kitSolids as unknown as Record<string, Record<string, Record<string, string>>>;

  it('has a spec and its words', async () => {
    for (const tool of SOLIDS_TOOLS) {
      const spec = await SPECS[tool.id]();
      const words = messages[tool.id];
      expect(words, tool.id).toBeDefined();
      for (const field of spec.fields) {
        expect(words.field?.[field.id], `${tool.id}.field.${field.id}`).toBeTypeOf('string');
        if (field.type === 'choice')
          for (const option of field.options) expect(words.option?.[option], option).toBeTypeOf('string');
        if (field.type === 'text') expect(words.hint?.[field.id], `${tool.id}.hint.${field.id}`).toBeTypeOf('string');
      }
      for (const example of spec.examples ?? []) {
        expect(words.example?.[example.id], example.id).toBeTypeOf('string');
        const run = runTool(spec, { ...firstTexts(spec), ...example.values }, 'si');
        expect(run.ok, `${tool.id} example ${example.id}`).toBe(true);
        if (run.ok) expectWords(tool.id, run.outcome, words);
      }
      const first = runTool(spec, firstTexts(spec), 'us');
      expect(first.ok, `${tool.id} first values`).toBe(true);
    }
  });

  function expectWords(
    tool: string,
    outcome: ReturnType<ToolSpec['run']>,
    words: Record<string, Record<string, string>>,
  ) {
    for (const row of outcome.rows) {
      expect(words.row?.[row.id], `${tool}.row.${row.id}`).toBeTypeOf('string');
      if (row.word) expect(words.word?.[row.word], `${tool}.word.${row.word}`).toBeTypeOf('string');
    }
    for (const note of outcome.notes ?? []) expect(words.note?.[note], `${tool}.note.${note}`).toBeTypeOf('string');
    for (const table of outcome.tables ?? []) {
      expect(words.table?.[table.id], `${tool}.table.${table.id}`).toBeTypeOf('string');
      for (const column of table.columns) expect(words.col?.[column], `${tool}.col.${column}`).toBeTypeOf('string');
    }
    for (const one of outcome.steps) {
      // A tool may borrow another tool's steps, such as the failure criteria, so each key names its own group.
      const [group, name] = one.key.split('.');
      const steps = messages.step[group] as unknown as Record<string, string>;
      expect(steps?.[name], `${tool}: ${one.key}`).toBeTypeOf('string');
    }
    if (outcome.picture)
      expect((words as unknown as Record<string, unknown>).picture, `${tool}.picture`).toBeTypeOf('string');
    if (outcome.picture) {
      const ctx = { system: 'si' as const, palette: PAGE, say: (key: string) => key };
      const drawn =
        outcome.picture.type === 'plot' ? plotSvg(outcome.picture.plot, ctx, tool) : outcome.picture.draw(ctx);
      expect(drawn).toMatch(/^<svg [^]*<\/svg>$/);
      expect(drawn).not.toContain('NaN');
    }
    if (outcome.picture?.type === 'plot') {
      const plot = outcome.picture.plot;
      for (const id of [
        plot.x.label,
        plot.y.label,
        ...plot.series.map((s) => s.id),
        ...(plot.marks ?? []).map((m) => m.id),
      ]) {
        expect(words.plot?.[id], `${tool}.plot.${id}`).toBeTypeOf('string');
      }
    }
  }
});
