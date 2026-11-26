import '../text';
import { describe, expect, it } from 'vitest';
import { initialValues, runTool } from '../spec';
import {
  bjtBias,
  bjtGain,
  diodePoint,
  mosfetBias,
  mosfetGain,
  rectifier,
  rectifierWaveform,
  thermalVoltage,
  zenerRegulator,
} from './engine';
import { spec } from './tool';

const close = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b));

describe('diode in series with a resistor', () => {
  it('5 V, 1 k, Is 1e-14 A, n 1, VT 25.852 mV: 4.3075 mA and 0.69254 V', () => {
    const p = diodePoint(5, 1000, 1e-14, 1, 0.025852);
    close(p.i, 4.3075e-3, 1e-4);
    close(p.v, 0.69254, 1e-4);
    // Both equations hold: the Shockley current and the resistor's Ohm's law.
    close(1e-14 * (Math.exp(p.v / 0.025852) - 1), p.i, 1e-9);
    close(p.v + p.i * 1000, 5, 1e-12);
  });
  it('a reverse source leaves the diode at about minus the supply and the current at about -Is', () => {
    const p = diodePoint(-5, 1000, 1e-14, 1, 0.025852);
    close(p.v, -5, 1e-9);
    expect(Math.abs(p.i)).toBeLessThan(1e-12);
  });
  it('survives a huge source and a tiny resistor', () => {
    const p = diodePoint(1000, 0.001, 1e-14, 1.5, 0.025852);
    expect(Number.isFinite(p.v) && Number.isFinite(p.i)).toBe(true);
    close(p.v + p.i * 0.001, 1000, 1e-9);
  });
  it('thermal voltage at 300 K is 25.852 mV', () => {
    close(thermalVoltage(300), 0.025852, 1e-4);
  });
});

describe('zener regulator', () => {
  it('regulates at Vz and splits the current between the zener and the load', () => {
    const z = zenerRegulator(12, 220, 5.1, 1000);
    expect(z.regulating).toBe(true);
    close(z.iSupply, (12 - 5.1) / 220, 1e-12);
    close(z.iLoad, 5.1e-3, 1e-12);
    close(z.iZener, z.iSupply - z.iLoad, 1e-12);
    close(z.vinMin, 6.222, 1e-9);
  });
  it('drops out of regulation when the supply is too low', () => {
    const z = zenerRegulator(5, 220, 5.1, 1000);
    expect(z.regulating).toBe(false);
    close(z.vout, 5 * (1000 / 1220), 1e-12);
    expect(z.iZener).toBe(0);
  });
});

describe('rectifier ripple', () => {
  it('half-wave, Vp 10 V, 60 Hz, 1 k, 100 uF: ripple 1.6667 V', () => {
    const r = rectifier(10, 0, 60, false, 1000, 100e-6);
    close(r.ripple, 10 / 6, 1e-12);
    close(r.dc, 10 - 10 / 12, 1e-12);
  });
  it('peak diode current follows Sedra and Smith: half wave 1 + 2 pi sqrt(2Vp/Vr), full wave 1 + pi sqrt(2Vp/Vr)', () => {
    // Hand values: IL = 9.1667 mA, sqrt(2 Vp / Vr) = sqrt(12); full wave: IL = 8.9125 mA, sqrt(2 Vp / Vr) = sqrt(24).
    close(rectifier(10, 0, 60, false, 1000, 100e-6).diodePeak, 0.208685, 1e-5);
    close(rectifier(10, 0.7, 60, true, 1000, 100e-6).diodePeak, 0.146081, 1e-5);
  });
  it('full wave halves the ripple, and a diode drop lowers the peak', () => {
    const full = rectifier(10, 0.7, 60, true, 1000, 100e-6);
    close(full.ripple, 9.3 / (120 * 1000 * 100e-6), 1e-12);
    close(full.peak, 9.3, 1e-12);
  });
  it('the simulated waveform ends within a few percent of the formula', () => {
    const w = rectifierWaveform(10, 0, 60, false, 1000, 100e-6, 6);
    const last = w.vout.slice(-200);
    const sim = Math.max(...last) - Math.min(...last);
    close(sim, 10 / 6, 0.2);
  });
  it('refuses a drop that stops conduction, and a capacitor too small to smooth', () => {
    expect(() => rectifier(0.5, 0.7, 60, false, 1000, 100e-6)).toThrow();
    expect(() => rectifier(10, 0, 60, false, 1000, 1e-9)).toThrow();
  });
});

describe('BJT bias', () => {
  const bias = bjtBias(12, 100e3, 20e3, 4.7e3, 1e3, 100, 0.7);
  it('12 V, 100 k / 20 k, RC 4.7 k, RE 1 k, beta 100: VTh 2 V, IC 1.1048 mA, VCE 5.6915 V', () => {
    close(bias.vth, 2, 1e-12);
    close(bias.rth, 16666.67, 1e-6);
    close(bias.ib, 11.048e-6, 1e-4);
    close(bias.ic, 1.1048e-3, 1e-4);
    close(bias.vce, 5.6915, 1e-4);
    expect(bias.region).toBe('active');
    // KVL around the collector loop, written independently.
    close(12, bias.ic * 4.7e3 + bias.vce + bias.ie * 1e3, 1e-9);
  });
  it('saturates with a big collector resistor, pinning VCE', () => {
    const s = bjtBias(12, 100e3, 20e3, 20e3, 1e3, 100, 0.7);
    expect(s.region).toBe('saturation');
    close(s.vce, 0.2, 1e-9);
    close(12, s.ic * 20e3 + s.vce + s.ie * 1e3, 1e-9);
    close(2, s.ib * s.rth + 0.7 + s.ie * 1e3, 1e-9);
    expect(s.ic).toBeLessThan(100 * s.ib);
  });
  it('is off when the base divider cannot reach VBE', () => {
    const c = bjtBias(12, 100e3, 5e3, 4.7e3, 1e3, 100, 0.7);
    expect(c.region).toBe('cutoff');
    expect(c.ic).toBe(0);
    close(c.vce, 12, 1e-12);
  });
  it('small-signal gain: bypassed is -gm (RC || RL || ro), unbypassed is about -RC/RE', () => {
    const vt = 0.025852;
    const g = bjtGain(bias, 100, vt, 4.7e3, 1e3, 10e3, 100, true, 100e3, 20e3);
    const gm = bias.ic / vt;
    const ro = 100 / bias.ic;
    close(g.gm, gm, 1e-12);
    close(g.gain, -gm / (1 / 4.7e3 + 1 / 10e3 + 1 / ro), 1e-12);
    close(g.rpi, 100 / gm, 1e-12);
    const u = bjtGain(bias, 100, vt, 4.7e3, 1e3, null, null, false, 100e3, 20e3);
    close(u.gain, (-100 * 4.7e3) / (100 / gm + 101 * 1e3), 1e-12);
    expect(Math.abs(u.gain + 4.7)).toBeLessThan(0.2);
  });
});

describe('MOSFET bias', () => {
  it('VDD 12, 200 k / 100 k gate divider, RD 3 k, RS 1 k, k 2 mA/V2, Vt 1 V is in saturation', () => {
    const m = mosfetBias(12, 200e3, 100e3, 3e3, 1e3, 2e-3, 1);
    expect(m.region).toBe('saturation');
    close(m.vg, 4, 1e-12);
    // The 2 defining equations, written separately: the square law and the gate loop.
    close(m.id, 1e-3 * (m.vgs - 1) ** 2, 1e-9);
    close(m.vg, m.vgs + m.id * 1e3, 1e-9);
    close(m.vov, (-1 + Math.sqrt(13)) / 2, 1e-9);
    close(m.vds, 12 - m.id * 4e3, 1e-9);
  });
  it('goes to triode when the drain resistor is large, and the triode equation holds', () => {
    const m = mosfetBias(12, 200e3, 100e3, 20e3, 1e3, 2e-3, 1);
    expect(m.region).toBe('triode');
    const triodeId = 2e-3 * ((m.vgs - 1) * m.vds - (m.vds * m.vds) / 2);
    close(m.id, triodeId, 1e-6);
    expect(m.vds).toBeLessThan(m.vov);
  });
  it('is off below threshold', () => {
    const m = mosfetBias(12, 900e3, 100e3, 3e3, 1e3, 2e-3, 1.5);
    expect(m.region).toBe('cutoff');
    expect(m.id).toBe(0);
  });
  it('works with no source resistor', () => {
    const m = mosfetBias(12, 200e3, 100e3, 500, 0, 2e-3, 1);
    close(m.id, 1e-3 * 9, 1e-12);
  });
  it('common-source gain is -gm (RD || RL || ro), or divided by 1 + gm RS when unbypassed', () => {
    const m = mosfetBias(12, 200e3, 100e3, 3e3, 1e3, 2e-3, 1);
    const g = mosfetGain(m, 2e-3, 3e3, 1e3, 6e3, 0.02, true);
    const gm = 2e-3 * m.vov;
    close(g.gm, gm, 1e-12);
    const ro = 1 / (0.02 * m.id);
    close(g.gain, -gm / (1 / 3e3 + 1 / 6e3 + 1 / ro), 1e-12);
    const u = mosfetGain(m, 2e-3, 3e3, 1e3, null, 0, false);
    close(u.gain, (-gm * 3e3) / (1 + gm * 1e3), 1e-12);
  });
});

describe('the diode and transistor tool form', () => {
  it('answers each circuit and names a problem input', () => {
    const base = initialValues(spec);
    for (const mode of ['diode', 'zener', 'rectifier', 'bjt', 'mosfet']) {
      expect(runTool(spec, { ...base, mode }).ok, mode).toBe(true);
    }
    expect(runTool(spec, { ...base, mode: 'rectifier', kind: 'fullwave' }).ok).toBe(true);
    expect(runTool(spec, { ...base, mode: 'bjt', bbypass: 'unbypassed', bearly: '', brl: '' }).ok).toBe(true);
    expect(runTool(spec, { ...base, mode: 'diode', dr: '0' }).ok).toBe(false);
    expect(runTool(spec, { ...base, mode: 'rectifier', rcap: '1n' }).ok).toBe(false);
    expect(runTool(spec, { ...base, mode: 'bjt', bbeta: 'x' }).ok).toBe(false);
  });
});
