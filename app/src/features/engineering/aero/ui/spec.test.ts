import { describe, expect, it } from 'vitest';
import { kitAero } from '../../../../strings/en/kitAero';
import { renderLatex } from '../../../math';
import { AeroError } from '../common';
import { LOADERS } from '../kit';
import { AERO_TOOLS } from '../meta';
import { ticks, plotTree, svgText } from './plot';
import { initialValues, readInputs, readNumber, runSpec, switchSystem, unitKey } from './spec';
import type { ToolSpec } from './spec';
import { hasText, pretty } from './words';

// eslint-disable-next-line no-control-regex -- looking for control characters is the point
const CONTROL = /[\u0000-\u001f]/;

const probe: ToolSpec = {
  id: 'atmosphere',
  fields: [
    { id: 'h', kind: 'quantity', qty: 'altitude', initial: '1000' },
    { id: 'T', kind: 'quantity', qty: 'temperature', initial: '288.15' },
    { id: 'n', kind: 'number', initial: '2', optional: true },
  ],
  run: (inputs) => ({ rows: [{ id: 'T', value: inputs.q('T') + inputs.q('h') * 0 }], steps: [] }),
};

describe('reading fields', () => {
  it('reads plain numbers, powers of ten, a true minus sign and short expressions', () => {
    expect(readNumber('1.5e3')).toBe(1500);
    expect(readNumber('−2')).toBe(-2);
    expect(readNumber('2*pi')).toBeCloseTo(2 * Math.PI, 12);
    expect(readNumber('1/4')).toBe(0.25);
    expect(readNumber('  ')).toBeUndefined();
    expect(readNumber('abc')).toBeNaN();
  });

  it('converts quantities to SI from the unit beside them', () => {
    const inputs = readInputs(probe, { h: '10000', [unitKey('h')]: 'ft', T: '59', [unitKey('T')]: '°F', n: '' });
    expect(inputs.q('h')).toBeCloseTo(3048, 9);
    expect(inputs.q('T')).toBeCloseTo(288.15, 9);
    expect(inputs.nOpt('n')).toBeUndefined();
  });

  it('names the field when a number is missing or unreadable', () => {
    const inputs = readInputs(probe, { h: 'ten', T: '' });
    expect(() => inputs.q('h')).toThrow(AeroError);
    try {
      inputs.q('T');
    } catch (error) {
      expect((error as AeroError).code).toBe('notNumber');
      expect((error as AeroError).vars.name).toBe('@f.T');
    }
    const result = runSpec(probe, { h: 'x', T: '1' });
    expect(result.ok).toBe(false);
  });

  it('switches SI and US without changing the problem, and leaves unreadable text alone', () => {
    const si = initialValues(probe, 'si');
    const us = switchSystem(probe, si, 'us');
    expect(us[unitKey('h')]).toBe('ft');
    expect(Number(us.h)).toBeCloseTo(3280.84, 2);
    expect(us[unitKey('T')]).toBe('°R');
    expect(Number(us.T)).toBeCloseTo(518.67, 6);
    const back = switchSystem(probe, us, 'si');
    expect(Number(back.h)).toBeCloseTo(1000, 3);
    const odd = switchSystem(probe, { ...si, h: 'ten' }, 'us');
    expect(odd.h).toBe('ten');
    expect(odd[unitKey('h')]).toBe('m');
  });
});

describe('plots and numbers', () => {
  it('picks round ticks', () => {
    expect(ticks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(ticks(-0.3, 0.3, 6)).toEqual([-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]);
  });

  it('writes a picture with fixed colors and escaped text', () => {
    const tree = plotTree(
      {
        title: 't',
        x: 'x',
        y: 'y',
        series: [
          {
            label: 's',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: NaN },
              { x: 2, y: 1 },
            ],
          },
        ],
      },
      { title: 'A < B & C', x: 'x', y: 'y', series: ['s'] },
    );
    const text = svgText(tree);
    expect(text.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(text).toContain('A &lt; B &amp; C');
    expect(text).not.toContain('$s0');
    expect(text).toContain('stroke-width');
  });

  it('shows powers of ten and minus signs for people', () => {
    expect(pretty(1.7894e-5, 5)).toBe('1.7894 × 10⁻⁵');
    expect(pretty(-2.5)).toBe('−2.5');
    expect(pretty(101325, 6)).toBe('101325');
  });
});

describe('every tool in the window', () => {
  for (const { id } of AERO_TOOLS) {
    it(`${id}: has its words and runs from its first values in SI and US alike`, async () => {
      const { spec } = await LOADERS[id]();
      expect(spec.id).toBe(id);
      for (const key of ['title', 'short', 'keywords', 'about', 'assume']) expect(hasText(id, key), key).toBe(true);
      for (const field of spec.fields) {
        expect(hasText(id, `f.${field.id}`), field.id).toBe(true);
        for (const option of field.options ?? []) expect(hasText(id, `o.${option}`), option).toBe(true);
      }
      const si = runSpec(spec, initialValues(spec, 'si'));
      const us = runSpec(spec, initialValues(spec, 'us'));
      if (!si.ok) throw si.error;
      if (!us.ok) throw us.error;
      si.output.rows.forEach((row, i) => {
        expect(hasText(id, `r.${row.id}`), row.id).toBe(true);
        if (row.word) expect(hasText(id, row.word.slice(1)), row.word).toBe(true);
        const other = us.output.rows[i]?.value;
        if (row.value !== undefined && Number.isFinite(row.value))
          expect(Math.abs((other ?? NaN) - row.value)).toBeLessThanOrEqual(1e-4 * Math.max(1, Math.abs(row.value)));
      });
      for (const step of si.output.steps) expect(hasText(id, `s.${step.key}`), step.key).toBe(true);
      // Every equation is LaTeX the page can draw: no lost escapes (a tab or form feed) and nothing KaTeX rejects.
      for (const math of [si.output.latex, ...si.output.steps.map((s) => s.math)]) {
        if (math === undefined) continue;
        expect(CONTROL.test(math), math).toBe(false);
        expect(renderLatex(math, { displayMode: true }).ok, math).toBe(true);
      }
      for (const plot of si.output.plots ?? []) {
        for (const key of [plot.title, plot.x, plot.y, ...plot.series.map((s) => s.label)])
          if (key !== '') expect(hasText(id, `p.${key}`), key).toBe(true);
        for (const mark of plot.marks ?? []) if (mark.label) expect(hasText(id, `p.${mark.label}`)).toBe(true);
      }
      if (si.output.headline) expect(hasText(id, si.output.headline.key)).toBe(true);
      for (const note of si.output.notes ?? []) expect(hasText(id, note.key), note.key).toBe(true);
      expect(Object.keys(kitAero.t)).toContain(id);
    });
  }
});
