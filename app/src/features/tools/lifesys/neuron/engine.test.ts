// Neurons against the planning pass's independent values (computed separately in Python), closed forms, and the
// documented errors.
import { describe, expect, it } from 'vitest';
import { LsError } from '../num/errors';
import {
  blocked,
  cableResult,
  currentClampResult,
  donnan,
  ghk,
  ghkCurrent,
  lengthConstant,
  lifIsi,
  lifResult,
  nernst,
  psp,
  rcCell,
  simulate,
  spikes,
  steadyGates,
  synapseResult,
  threshold,
  velocity,
  voltageClamp,
  waveform,
  type SynapseInput,
} from './engine';

const throwsKey = (fn: () => unknown, key: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LsError);
    expect((e as LsError).key).toBe(key);
    return;
  }
  throw new Error(`expected ${key}`);
};
const value = (r: { rows: { label: string; value: number | string }[] }, label: string) =>
  r.rows.find((x) => x.label === `neuron.r.${label}`)?.value as number;

describe('membrane potentials', () => {
  it('gives the Nernst K⁺ potential −89.0587 mV at 37 °C for 5 and 140 mM', () => {
    expect(nernst(1, 5, 140, 37)).toBeCloseTo(-89.0587, 4);
    // The same from log₁₀: 61.5 mV per decade.
    expect(nernst(1, 5, 140, 37)).toBeCloseTo(((1000 * 8.314462618 * 310.15) / 96485.33212) * Math.log(5 / 140), 9);
    expect(nernst(2, 10, 10, 37)).toBe(0);
  });

  it('gives the GHK potential −67.3431 mV for 1 : 0.04 : 0.45', () => {
    const { V } = ghk(
      { pK: 1, pNa: 0.04, pCl: 0.45, kOut: 5, kIn: 140, naOut: 145, naIn: 15, clOut: 110, clIn: 10 },
      37,
    );
    expect(V).toBeCloseTo(-67.3431, 4);
  });

  it('reduces GHK to Nernst for one permeant ion', () => {
    const { V } = ghk({ pK: 1, pNa: 0, pCl: 0, kOut: 5, kIn: 140, naOut: 145, naIn: 15, clOut: 110, clIn: 10 }, 37);
    expect(V).toBeCloseTo(nernst(1, 5, 140, 37), 9);
  });

  it('gives a GHK current of 0 at the reversal potential and the V = 0 limit', () => {
    const e = nernst(1, 5, 140, 37);
    expect(ghkCurrent(1e-6, 1, 140, 5, e, 37)).toBeCloseTo(0, 9);
    expect(ghkCurrent(1e-6, 1, 140, 5, 0, 37)).toBeCloseTo(1e-6 * 96485.33212 * 135, 6);
    expect(ghkCurrent(1e-6, 1, 140, 5, 1e-12, 37)).toBeCloseTo(ghkCurrent(1e-6, 1, 140, 5, 0, 37), 6);
  });

  it('balances a Donnan system', () => {
    const d = donnan(100, 50, -1, 25);
    expect(d.kIn * d.clIn).toBeCloseTo(100 * 100, 6);
    expect(d.kIn - d.clIn).toBeCloseTo(50, 9);
    expect(d.E).toBeLessThan(0);
  });

  it('rejects impossible input', () => {
    throwsKey(() => nernst(0, 5, 140, 37), 'neuron.e.valence');
    throwsKey(() => nernst(1, 5, 140, -300), 'neuron.e.kelvin');
    throwsKey(() => nernst(1, 0, 140, 37), 'errors.positive');
    throwsKey(() => donnan(100, 50, 1, 25), 'neuron.e.anion');
  });
});

describe('passive properties', () => {
  it('gives λ 1 mm, V(2 mm)/V0 0.135335, and τm 20 ms for Rm 20 000, Ri 100, d 2 µm', () => {
    expect(lengthConstant(20000, 100, 2)).toBeCloseTo(1, 9);
    const r = cableResult(20000, 100, 2, 1, 2);
    expect(value(r, 'ratio')).toBeCloseTo(0.135335, 6);
    expect(value(r, 'tau')).toBeCloseTo(20, 9);
  });

  it('gives a sphere’s RC values', () => {
    const c = rcCell(20000, 1, 20);
    expect(c.tau).toBeCloseTo(20, 9);
    // R_in C = τ.
    expect(c.rin * 1e6 * c.cap * 1e-12 * 1e3).toBeCloseTo(20, 9);
  });

  it('scales velocity linearly with myelin and by √d without', () => {
    expect(velocity(10, true)).toBe(60);
    expect(velocity(4, false)).toBe(2);
  });
});

describe('integrate and fire', () => {
  const p = { tau: 10, el: -65, reset: -65, th: -50, r: 10, i: 2, ref: 0 };

  it('gives ISI 13.8629 ms and 72.1348 Hz', () => {
    expect(lifIsi(p)).toBeCloseTo(13.8629, 4);
    expect(1000 / lifIsi(p)).toBeCloseTo(72.1348, 4);
    expect(lifIsi({ ...p, ref: 2 })).toBeCloseTo(15.8629, 4);
  });

  it('never fires below rheobase, and counts spikes in the trace', () => {
    expect(lifIsi({ ...p, i: 1.5 })).toBe(Infinity);
    const r = lifResult(p, 100);
    expect(value(r, 'spikes')).toBe(7);
    throwsKey(() => lifResult({ ...p, reset: -40 }, 100), 'neuron.e.reset');
  });
});

describe('Hodgkin-Huxley', () => {
  const p = blocked('none', 6.3);

  it('rests near −65 mV with no input', () => {
    const run = simulate(p, () => 0, 50);
    expect(spikes(run)).toHaveLength(0);
    expect(run.v[run.v.length - 1]).toBeCloseTo(-64.996, 1);
  });

  it('fires 4 spikes for a 10 µA/cm² step, the first peaking at 40.27 mV at 2.139 ms', () => {
    const run = simulate(p, () => 10, 50);
    const found = spikes(run);
    expect(found).toHaveLength(4);
    expect(Math.abs(found[0].peak - 40.27)).toBeLessThan(0.5);
    expect(Math.abs(found[0].time - 2.139)).toBeLessThan(0.1);
  });

  it('has no spikes with TTX', () => {
    const r = currentClampResult({ protocol: 'step', amp: 10, start: 0, width: 0, rate: 0 }, 30, 'ttx', 6.3);
    expect(value(r, 'spikeCount')).toBe(0);
  });

  it('gives steady gates between 0 and 1 and the limits at the singular voltages', () => {
    for (const v of [-55, -40, -65, 0]) {
      const g = steadyGates(v);
      for (const x of [g.m, g.h, g.n]) expect(x > 0 && x < 1).toBe(true);
    }
  });

  it('shows an inward sodium peak and an outward potassium current under voltage clamp', () => {
    const c = voltageClamp(-65, 0, 10, 'none', 6.3);
    expect(Math.min(...c.iNa)).toBeLessThan(-100);
    expect(c.iK[c.iK.length - 1]).toBeGreaterThan(100);
    // Sodium inactivates: the end is far smaller than the peak.
    expect(Math.abs(c.iNa[c.iNa.length - 1])).toBeLessThan(0.1 * Math.abs(Math.min(...c.iNa)));
    expect(Math.max(...voltageClamp(-65, 0, 10, 'tea', 6.3).iK)).toBe(0);
  });

  it('needs more current right after a spike', () => {
    const rest = threshold(0.5, 6.3, null);
    const after = threshold(0.5, 6.3, 8);
    expect(rest.amp).toBeGreaterThan(5);
    expect(after.amp === null || after.amp > (rest.amp as number)).toBe(true);
  });
});

describe('synapses', () => {
  const base: SynapseInput = {
    kind: 'alpha',
    g: 1,
    tau: 2,
    rise: 0,
    eSyn: 0,
    events: 1,
    interval: 5,
    synapses: 1,
    eL: -70,
    rin: 100,
    tauM: 20,
    gInh: 0,
    eInh: -70,
  };

  it('peaks the alpha and dual-exponential shapes at 1', () => {
    expect(waveform('alpha', 2, 0)(2)).toBeCloseTo(1, 12);
    const f = waveform('dual', 5, 1);
    const tp = ((5 * 1) / 4) * Math.log(5);
    expect(f(tp)).toBeCloseTo(1, 12);
    throwsKey(() => waveform('dual', 1, 5), 'neuron.e.rise');
  });

  it('sums sublinearly across synapses and shunts with inhibition at rest', () => {
    const one = psp(base).peak;
    const ten = psp({ ...base, synapses: 10 }).peak;
    expect(one).toBeGreaterThan(0);
    expect(ten).toBeLessThan(10 * one);
    expect(ten).toBeGreaterThan(5 * one);
    const r = synapseResult({ ...base, synapses: 10, gInh: 20, eInh: -70 });
    expect(value(r, 'inhibition')).toBeGreaterThan(10);
  });

  it('gives an IPSP below rest for a reversal below rest', () => {
    expect(psp({ ...base, eSyn: -80 }).peak).toBeLessThan(0);
  });
});
