// Every earth kit calculation, run with the values its form starts with: each must give an answer, and every
// label, option, step, and picture description it uses must exist in the strings.
import { describe, expect, it } from 'vitest';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { figureSvg } from './core/figure';
import { MODE_LOADERS } from './loaders';
import { EARTH_TOOL_IDS } from './meta';
import { initialValues, run } from './ui/form';
import { stepsText, tableOf } from './ui/InsertControls';

describe('earth kit forms', () => {
  for (const tool of EARTH_TOOL_IDS) {
    it(`answers every ${tool} calculation with its first values`, async () => {
      expect(t(`kitEarth.tools.${tool}.title` as MessageKey)).toBeTruthy();
      expect(t(`kitEarth.tools.${tool}.open` as MessageKey)).toBeTruthy();
      for (const mode of await MODE_LOADERS[tool]()) {
        expect(t(mode.label), mode.id).toBeTruthy();
        if (mode.intro) expect(t(mode.intro)).toBeTruthy();
        for (const field of mode.fields) {
          expect(t(field.label), field.id).toBeTruthy();
          for (const option of field.options ?? []) expect(t(option.label), option.value).toBeTruthy();
        }
        const result = run(tool, mode, initialValues(mode));
        expect(result.ok ? 'ok' : result.message, `${tool} ${mode.id}`).toBe('ok');
        if (!result.ok) continue;
        expect(result.outcome.answer).not.toMatch(/NaN|undefined/);
        expect(stepsText(result.outcome)).not.toMatch(/NaN|undefined|\{/);
        tableOf(result.outcome);
        for (const figure of result.outcome.figures ?? []) {
          expect(figure.description).not.toMatch(/NaN|undefined/);
          expect(figureSvg(figure)).toMatch(/^<svg/);
        }
      }
    });
  }
});

describe('earth kit wording and axes', () => {
  async function outcome(tool: (typeof EARTH_TOOL_IDS)[number], id: string, text: Record<string, string> = {}) {
    const mode = (await MODE_LOADERS[tool]()).find((m) => m.id === id)!;
    const values = initialValues(mode);
    const result = run(tool, mode, { ...values, text: { ...values.text, ...text } });
    if (!result.ok) throw new Error(result.message);
    return result.outcome;
  }

  it('agrees the stereonet count with one or many', async () => {
    const one = await outcome('stereonet', 'plot', { data: 'plane, 030, 40\nline, 250, 30' });
    expect(one.answer).toContain('1 plane and 1 line on');
    const many = await outcome('stereonet', 'plot');
    expect(many.answer).toContain('3 planes and 1 line on');
    expect(many.figures![0].description).toContain('3 planes and 1 line on the net');
  });

  it('lists every default stereonet item once, the dip-direction one under its own label', async () => {
    const table = tableOf(await outcome('stereonet', 'plot'))!;
    const orient = table.rows.map((row) => row.slice(1).join(' '));
    expect(new Set(orient).size).toBe(orient.length);
    // Dip direction 300 under the right-hand rule is strike 300 - 90 = 210, dip 50.
    const s2 = table.rows.find((row) => row[0] === 'S2')!;
    expect(s2.join(' ')).toContain('210');
    expect(s2.join(' ')).toContain('50');
  });

  it('gives TEOS-10 seawater at S 35, 5 °C, the surface a density that EOS-80 matches to 0.001 kg/m³', async () => {
    // EOS-80 gives 1027.6753 kg/m³ for this sample.
    const result = await outcome('ocean', 'teos10');
    expect(result.answer).toMatch(/^Density: 1027\.67/);
    expect(result.steps?.join(' ')).toContain('75-term polynomial');
    expect(result.source).toContain('TEOS-10');
    expect(result.rows).toHaveLength(11);
  });

  it('gives a stable N² for every layer of the default TEOS-10 profile', async () => {
    const result = await outcome('ocean', 'teosN2');
    expect(result.answer).toMatch(/^N² across 4 layers/);
    // Thermocline N² is of order 10⁻⁵ to 10⁻⁴ 1/s², deep water nearer 10⁻⁶.
    for (const row of tableOf(result)!.rows) {
      const [, mantissa, power] = /^([\d.]+) × 10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)/.exec(row[1])!;
      const exponent = Number([...power].map((c) => (c === '⁻' ? '-' : '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c))).join(''));
      const n2 = Number(mantissa) * 10 ** exponent;
      expect(n2).toBeGreaterThan(1e-6);
      expect(n2).toBeLessThan(1e-3);
    }
  });

  it('ticks the climate diagram once per month, J to D, with no fractional months', async () => {
    const fig = (await outcome('climate', 'koppen')).figures![0];
    const ticks = fig.marks.filter((m) => m.kind === 'text' && m.size === 10 && m.anchor === 'middle');
    expect(ticks.map((m) => (m.kind === 'text' ? m.text : ''))).toEqual('JFMAMJJASOND'.split(''));
  });
});
