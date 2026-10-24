// The specs turn typed fields into engine calls and engine numbers into rows. These tests check the whole path against
// a hand calculation, and that every example the window offers works.
import { describe, expect, it } from 'vitest';
import { firstTexts, firstUnits, runTool } from '../kit/read';
import type { Outcome, ToolSpec } from '../kit/spec';
import { SPECS } from './index';

async function run(tool: string, texts: Record<string, string>, units: Record<string, string> = {}): Promise<Outcome> {
  const spec = await SPECS[tool]!();
  const done = runTool(spec, { ...firstTexts(spec), ...texts }, { ...firstUnits(spec, 'si'), ...units });
  if (!done.ok || !done.result.ok) throw new Error(JSON.stringify(done));
  return done.result.outcome;
}

const row = (o: Outcome, id: string): number => {
  const found = o.rows.find((r) => r.id === id);
  if (found?.value === undefined) throw new Error(`no row ${id}`);
  return found.value;
};

describe('every example works', () => {
  for (const [tool, load] of Object.entries(SPECS)) {
    it(`${tool}`, async () => {
      const spec: ToolSpec = await load();
      for (const example of spec.examples ?? []) {
        const done = runTool(spec, { ...firstTexts(spec), ...example.values }, firstUnits(spec, 'si'));
        expect(done.ok, example.id).toBe(true);
        if (done.ok) expect(done.result.ok, example.id).toBe(true);
      }
    });
  }
});

describe('machining against hand calculations', () => {
  it('turning a 50 mm bar at 150 m/min, 0.25 mm/rev, 200 mm long', async () => {
    const o = await run('machining', { mode: 'turning' });
    const rpm = (1000 * 150) / (Math.PI * 50);
    expect(row(o, 'rpm')).toBeCloseTo(rpm, 9);
    expect(row(o, 'feedRate')).toBeCloseTo(0.25 * rpm, 9);
    expect(row(o, 'mrr')).toBeCloseTo(1000 * 150 * 0.25 * 2, 6);
    expect(row(o, 'time')).toBeCloseTo(200 / (0.25 * rpm), 9);
  });
  it('a US-unit diameter is converted before the engine sees it', async () => {
    const o = await run('machining', { mode: 'turning', d: '2', v: '500' }, { d: 'in', v: 'ft/min', depth: 'mm' });
    expect(row(o, 'rpm')).toBeCloseTo((1000 * 500 * 0.3048) / (Math.PI * 50.8), 9);
  });
  it('Taylor: V T^n = C', async () => {
    const o = await run('machining', { mode: 'life', v: '150', n: '0.25', c: '400' });
    expect(row(o, 'life')).toBeCloseTo((400 / 150) ** 4, 9);
    const speed = await run('machining', { mode: 'life', find: 'speed', life: '30', n: '0.25', c: '400' });
    expect(row(speed, 'speed')).toBeCloseTo(400 / 30 ** 0.25, 9);
  });
  it('economic life is (1/n - 1)(Tc + Ce/Co)', async () => {
    const o = await run('machining', {
      mode: 'economics',
      n: '0.25',
      c: '400',
      changeTime: '2',
      edgeCost: '4',
      rate: '1',
    });
    expect(row(o, 'costLife')).toBeCloseTo(3 * (2 + 4), 9);
    expect(row(o, 'rateLife')).toBeCloseTo(3 * 2, 9);
  });
  it('Merchant: 45 + 10/2 - 30/2 = 35 degrees', async () => {
    const o = await run('machining', { mode: 'shear', rake: '10', friction: '30' });
    expect(row(o, 'phi')).toBeCloseTo(35, 9);
  });
  it('an impossible cut says why', async () => {
    const spec = await SPECS.machining!();
    const done = runTool(spec, { ...firstTexts(spec), mode: 'turning', depth: '30' }, firstUnits(spec, 'si'));
    expect(done.ok && !done.result.ok && done.result.problem).toBe('depthTooDeep');
  });
});

describe('forming against hand calculations', () => {
  it('rolling 25 mm to 20 mm with a 250 mm roll', async () => {
    const o = await run('forming', { mode: 'rolling' });
    const contact = Math.sqrt(250 * 5);
    expect(row(o, 'contact')).toBeCloseTo(contact, 9);
    expect(row(o, 'force')).toBeCloseTo(250 * 300 * contact, 6);
    expect(row(o, 'maxDraft')).toBeCloseTo(0.12 ** 2 * 250, 9);
    expect(o.rows.some((r) => r.id === 'power')).toBe(false);
  });
  it('rolling power appears when a roll speed is typed (rpm in, W out)', async () => {
    const o = await run('forming', { mode: 'rolling', speed: '120' }, { speed: 'rpm' });
    const contact = Math.sqrt(1250);
    expect(row(o, 'power')).toBeCloseTo(2 * Math.PI * 2 * (250 * 300 * contact) * contact, 3);
  });
  it('bend allowance BA = a (R + K t)', async () => {
    const o = await run('forming', { mode: 'bend', radius: '5', angle: '90', thickness: '2', kFactor: '0.33' });
    expect(row(o, 'allowance')).toBeCloseTo((Math.PI / 2) * (5 + 0.33 * 2), 9);
  });
  it('the pattern allows the shrinkage typed as a percent', async () => {
    const o = await run('forming', { mode: 'pattern', length: '200', shrinkage: '1.3' });
    expect(row(o, 'pattern')).toBeCloseTo(200 * 1.013, 9);
  });
  it('weld heat input is eta V I / v', async () => {
    const o = await run('forming', { mode: 'weld' });
    expect(row(o, 'heat')).toBeCloseTo((0.8 * 24 * 200) / 5, 9);
  });
  it('Chvorinov: t = B (V/A)^2', async () => {
    const o = await run('forming', { mode: 'solidify' });
    expect(row(o, 'time')).toBeCloseTo(2 * (1000 / 600) ** 2, 9);
  });
});

describe('micro and nano fabrication against hand calculations', () => {
  it('193 nm at NA 1.35: R = 0.25 lambda / NA', async () => {
    const o = await run('microfab', { mode: 'litho' });
    expect(row(o, 'resolution')).toBeCloseTo((0.25 * 193) / 1.35, 9);
    expect(row(o, 'dof')).toBeCloseTo(193 / 1.35 ** 2, 9);
  });
  it('Stoney in MPa: 130 GPa, 0.28, 500 um, 1 um, R = 100 m', async () => {
    const o = await run('microfab', { mode: 'stoney' }, { es: 'GPa', hs: 'µm', hf: 'µm' });
    expect(row(o, 'stress')).toBeCloseTo((130e9 * 500e-6 ** 2) / (6 * 0.72 * 100 * 1e-6) / 1e6, 6);
  });
  it('the etch selectivity row appears only when a mask rate is typed', async () => {
    expect((await run('microfab', { mode: 'etch' })).rows.some((r) => r.id === 'selectivity')).toBe(false);
    expect(row(await run('microfab', { mode: 'etch', mask: '4' }), 'selectivity')).toBeCloseTo(25, 9);
  });
  it('Murphy yield is shown as a percent', async () => {
    const o = await run('microfab', { mode: 'yield', model: 'murphy', defects: '0.5', dieAreaCm: '1' });
    expect(row(o, 'yield')).toBeCloseTo(((1 - Math.exp(-0.5)) / 0.5) ** 2 * 100, 9);
  });
  it('binding: Kd = koff / kon and the equilibrium fraction', async () => {
    const o = await run('microfab', { mode: 'binding', kon: '1e5', koff: '0.01', conc: '0.1' });
    expect(row(o, 'kd')).toBeCloseTo(1e-7, 15);
    expect(row(o, 'theta')).toBeCloseTo(0.5, 9);
  });
});

describe('number representation against independent calculations', () => {
  it('-42 in 8 bits is 1101 0110, 0xD6', async () => {
    const o = await run('numrep', { mode: 'encode', value: '-42', width: '8' });
    expect(o.rows.find((r) => r.id === 'bits')?.text).toBe('1101 0110');
    expect(o.rows.find((r) => r.id === 'hex')?.text).toBe('0xD6');
    expect(o.rows.find((r) => r.id === 'min')?.text).toBe('-128');
  });
  it('0xD6 read as each scheme', async () => {
    const o = await run('numrep', { mode: 'decode', bits: '1101 0110' });
    const text = (id: string) => o.rows.find((r) => r.id === id)?.text;
    expect(text('asUnsigned')).toBe('214');
    expect(text('asTwos')).toBe('-42');
    expect(text('asOnes')).toBe('-41');
    expect(text('asSignmag')).toBe('-86');
  });
  it('200 wraps to -56 in a signed byte', async () => {
    const o = await run('numrep', { mode: 'overflow', value: '200', width: '8' });
    expect(o.rows.find((r) => r.id === 'wrapped')?.text).toBe('-56');
  });
  it('255 in base 16 is FF and 0.1 in single is 0x3DCCCCCD, as the platform stores it', async () => {
    expect((await run('numrep', { mode: 'base', digits: '255', from: '10', to: '16' })).rows[0]?.text).toBe('FF');
    const o = await run('numrep', { mode: 'float', decimal: '0.1', format: 'single' });
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, 0.1);
    expect(o.rows.find((r) => r.id === 'hex')?.text).toBe(`0x${view.getUint32(0).toString(16).toUpperCase()}`);
    expect(o.rows.find((r) => r.id === 'exact')?.text).toBe('0.100000001490116119384765625');
  });
  it('the single-precision pattern of pi decodes to 3.1415927', async () => {
    const o = await run('numrep', { mode: 'floatBits', pattern: '0x40490FDB', format: 'single' });
    expect(o.rows.find((r) => r.id === 'shortest')?.text).toBe('3.1415927');
  });
  it('an unfit value names the range', async () => {
    const spec = await SPECS.numrep!();
    const done = runTool(spec, { ...firstTexts(spec), value: '300' }, {});
    expect(done.ok && !done.result.ok && done.result.detail).toBe('-128 to 127');
  });
});
