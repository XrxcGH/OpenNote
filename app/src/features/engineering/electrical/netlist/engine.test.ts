import { describe, expect, it } from 'vitest';
import { initialValues, runTool } from '../spec';
import { acSweep, findResonance, operatingPoint, thevenin, transient } from './analysis';
import { layoutOf } from './mna';
import { nodeIndex, parseNetlist, readValue } from './parse';
import { parseProbe, parseProbes } from './probes';
import { breakpoints, switchClosed, valueAt } from './sources';
import { spec } from './tool';

const close = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b));
const near = (a: number, b: number, abs: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(abs);

function volt(text: string, node: string): number {
  const c = parseNetlist(text);
  const op = operatingPoint(c);
  return op.x[nodeIndex(c, node)!]!;
}

function tran(text: string, probe: string, step: number, stop: number) {
  const c = parseNetlist(text);
  const lay = layoutOf(c);
  return transient(c, lay, parseProbes(c, lay, probe), step, stop);
}

const at = (run: { t: number[]; values: number[][] }, time: number, probe = 0): number => {
  const i = run.t.findIndex((t) => Math.abs(t - time) < 1e-12);
  return run.values[probe]![i]!;
};

describe('DC operating point', () => {
  const divider = 'V1 in 0 10\nR1 in mid 1k\nR2 mid 0 1k';
  it('10 V across 1 k and 1 k: midpoint 5 V, current 5 mA', () => {
    const c = parseNetlist(divider);
    const op = operatingPoint(c);
    near(op.x[nodeIndex(c, 'mid')!]!, 5, 5e-9);
    close(Math.abs(op.x[op.lay.branch.get('v1')!]!), 5e-3, 1e-9);
  });
  it('the powers of all elements add to zero, and the source supplies what the resistors absorb', () => {
    const op = operatingPoint(parseNetlist(divider));
    near(op.balance, 0, 1e-9);
    close(op.powers.find((p) => p.name === 'R1')!.power, 25e-3, 1e-9);
    close(op.powers.find((p) => p.name === 'V1')!.power, -50e-3, 1e-9);
  });
  it('inverting op-amp, Rin 1 k, Rf 10 k, 0.5 V in: -5 V out', () => {
    near(volt('V1 in 0 0.5\nR1 in n 1k\nR2 n out 10k\nO1 out 0 n', 'out'), -5, 5e-9);
  });
  it('non-inverting op-amp gain 1 + Rf/Rg', () => {
    near(volt('V1 in 0 1\nO1 out in n\nR1 out n 9k\nR2 n 0 1k', 'out'), 10, 5e-9);
  });
  it('the 4 dependent sources', () => {
    near(volt('V1 in 0 2\nR1 in 0 1k\nE1 out 0 in 0 3\nR2 out 0 1k', 'out'), 6, 5e-9);
    near(volt('V1 in 0 1\nR1 in 0 1k\nG1 0 out in 0 2m\nR2 out 0 1k', 'out'), 2, 5e-9);
    near(volt('V1 in 0 1\nR1 in 0 1k\nF1 out 0 V1 2\nR2 out 0 1k', 'out'), 2, 5e-9);
    near(volt('V1 in 0 1\nR1 in 0 1k\nH1 out 0 V1 1k\nR2 out 0 1k', 'out'), -1, 5e-9);
  });
  it('a current source and the sign of its current', () => {
    // 1 mA flows from the + node through the source to the - node, so it pulls node a below ground.
    near(volt('I1 a 0 1m\nR1 a 0 1k', 'a'), -1, 5e-9);
    near(volt('I1 0 a 1m\nR1 a 0 1k', 'a'), 1, 5e-9);
  });
  it('a capacitor is open and an inductor is a short in DC', () => {
    near(volt('V1 in 0 5\nR1 in a 1k\nC1 a 0 1u\nR2 a 0 1k', 'a'), 2.5, 5e-9);
    near(volt('V1 in 0 5\nR1 in a 1k\nL1 a b 1m\nR2 b 0 1k', 'b'), 2.5, 5e-9);
  });
  it('a node with no DC path reads 0 V instead of failing', () => {
    near(volt('V1 in 0 5\nC1 in a 1u\nC2 a 0 1u', 'a'), 0, 1e-6);
  });
  it('says so when the circuit has no unique answer', () => {
    expect(() => operatingPoint(parseNetlist('V1 a 0 5\nV2 a 0 3\nR1 a 0 1k'))).toThrow();
    expect(() => operatingPoint(parseNetlist('I1 a 0 1m\nI2 a 0 1m'))).toThrow();
  });
});

describe('Thevenin and Norton', () => {
  it('bridge: 10 V, 1 k over 2 k on the left, 3 k over 1 k on the right: 4.1667 V and 1416.67 ohm', () => {
    const c = parseNetlist('V1 in 0 10\nR1 in a 1k\nR2 a 0 2k\nR3 in b 3k\nR4 b 0 1k');
    const eq = thevenin(c, nodeIndex(c, 'a')!, nodeIndex(c, 'b')!);
    close(eq.vth, 4.1667, 1e-5);
    close(eq.vth, 20 / 3 - 2.5, 1e-9);
    close(eq.rth, 1416.67, 1e-5);
    close(eq.rth, (1000 * 2000) / 3000 + (3000 * 1000) / 4000, 1e-9);
    close(eq.norton, eq.vth / eq.rth, 1e-12);
    close(eq.maxPower, (eq.vth * eq.vth) / (4 * eq.rth), 1e-12);
  });
  it('keeps dependent sources on while it zeroes the independent ones', () => {
    // The VCCS draws gm v(b), the same as a 1 k resistor to ground, so the equivalent is 5 V behind 500 ohm.
    const c = parseNetlist('V1 a 0 10\nR1 a b 1k\nG1 b 0 b 0 1m');
    const eq = thevenin(c, nodeIndex(c, 'b')!, -1);
    close(eq.vth, 5, 1e-9);
    close(eq.rth, 500, 1e-9);
  });
  it('a source with no resistance behind it gives a zero Thevenin resistance', () => {
    const c = parseNetlist('V1 a 0 5');
    const eq = thevenin(c, nodeIndex(c, 'a')!, -1);
    close(eq.vth, 5, 1e-12);
    near(eq.rth, 0, 1e-9);
  });
});

describe('AC sweep', () => {
  const rlc = 'V1 in 0 AC 1 0\nR1 in a 10\nL1 a b 10m\nC1 b 0 10u';
  it('series R 10, L 10 mH, C 10 uF: resonance 503.29 Hz, |I| = 0.1 A there, Q = 3.1623', () => {
    const c = parseNetlist(rlc);
    const lay = layoutOf(c);
    const probes = parseProbes(c, lay, 'i(V1)');
    const sweep = acSweep(c, lay, probes, 10, 100000, 200);
    const r = findResonance(c, lay, probes[0]!, sweep);
    close(r.f0, 503.29, 1e-5);
    close(r.peak, 0.1, 1e-6);
    close(r.q!, 3.1623, 1e-5);
    close(r.bandwidth!, 10 / (2 * Math.PI * 0.01), 1e-6);
    // 1 / (2 pi sqrt(LC)) written separately.
    close(r.f0, 1 / (2 * Math.PI * Math.sqrt(0.01 * 10e-6)), 1e-7);
  });
  it('RC low-pass has its 3 dB point at 1/(2 pi R C) and -45 degrees there', () => {
    const c = parseNetlist('V1 in 0 AC 1 0\nR1 in out 1k\nC1 out 0 1u');
    const lay = layoutOf(c);
    const probes = parseProbes(c, lay, 'out');
    const sweep = acSweep(c, lay, probes, 0.01, 1e5, 300);
    const r = findResonance(c, lay, probes[0]!, sweep);
    expect(r.lowpass).toBe(true);
    close(r.cutoff!, 1 / (2 * Math.PI * 1e-3), 1e-6);
    const k = sweep.freqs.findIndex((f) => f > r.cutoff!);
    expect(sweep.phase[0]![k]!).toBeLessThan(-40);
    expect(sweep.phase[0]![k]!).toBeGreaterThan(-50);
  });
  it('an RC high-pass has a cutoff at the same place, from the other side', () => {
    const c = parseNetlist('V1 in 0 AC 1 0\nC1 in out 1u\nR1 out 0 1k');
    const lay = layoutOf(c);
    const probes = parseProbes(c, lay, 'out');
    const r = findResonance(c, lay, probes[0]!, acSweep(c, lay, probes, 1, 1e9, 400));
    expect(r.lowpass).toBe(false);
    close(r.cutoff!, 1 / (2 * Math.PI * 1e-3), 1e-6);
  });
  it('the 3 dB point is measured from the passband gain, however narrow the sweep', () => {
    // RC 1k, 1 uF: the true cutoff is 1 / (2 pi R C) = 159.155 Hz.
    const net = (...lines: string[]) => parseNetlist(lines.join('\n'));
    const lp = net('V1 in 0 AC 1 0', 'R1 in out 1k', 'C1 out 0 1u');
    const hp = net('V1 in 0 AC 1 0', 'C1 in out 1u', 'R1 out 0 1k');
    const cut = (c: ReturnType<typeof parseNetlist>, lo: number, hi: number) => {
      const lay = layoutOf(c);
      const probes = parseProbes(c, lay, 'out');
      return findResonance(c, lay, probes[0]!, acSweep(c, lay, probes, lo, hi, 200)).cutoff!;
    };
    const exact = 1 / (2 * Math.PI * 1e-3);
    close(cut(lp, 100, 1e4), exact, 1e-6);
    close(cut(lp, 10, 1e5), exact, 1e-6);
    close(cut(hp, 1, 1e3), exact, 1e-6);
  });
  it('a maximally flat Sallen-Key high-pass has a cutoff, not a phantom peak, and Q 0.70711 at f0', () => {
    const c = parseNetlist(
      ['V1 in 0 AC 1 0', 'C1 in a 10n', 'C2 a b 10n', 'R1 a out 10k', 'R2 b 0 20k', 'E1 out 0 b 0 1'].join('\n'),
    );
    const lay = layoutOf(c);
    const probes = parseProbes(c, lay, 'out');
    const r = findResonance(c, lay, probes[0]!, acSweep(c, lay, probes, 1, 1e7, 400));
    // Hand derivation: f0 = 1 / (2 pi sqrt(R1 R2 C1 C2)) = 1125.4 Hz and Q = sqrt(R2 C1 C2 / R1) / (C1 + C2) = 0.70711.
    const f0 = 1 / (2 * Math.PI * Math.sqrt(1e4 * 2e4 * 1e-16));
    expect(r.cutoff).not.toBeNull();
    close(r.cutoff!, f0, 1e-4);
    close(acSweep(c, lay, probes, f0, f0 * 1.0001, 2).mag[0]![0]!, 0.70711, 1e-5);
  });
  it('reads values with a unit word or a capital K: 10uF, 1kΩ, 1kohm, 2.2K, 5V', () => {
    expect(readValue('10uF')).toBeCloseTo(1e-5, 15);
    expect(readValue('1kΩ')).toBe(1000);
    expect(readValue('1kohm')).toBe(1000);
    expect(readValue('2.2K')).toBeCloseTo(2200, 9);
    expect(readValue('5V')).toBe(5);
    expect(readValue('1meg')).toBe(1e6);
    expect(readValue('10f')).toBeCloseTo(1e-14, 25);
    expect(readValue('AC')).toBeNull();
    const c = parseNetlist(['V1 in 0 5V', 'R1 in out 1kΩ', 'C1 out 0 10uF'].join(String.fromCharCode(10)));
    expect(c.elements[1]!.value).toBe(1000);
    expect(c.elements[2]!.value).toBeCloseTo(1e-5, 15);
    near(volt(['V1 in 0 5V', 'R1 in out 1kΩ', 'R2 out 0 1kohm'].join(String.fromCharCode(10)), 'out'), 2.5, 1e-9);
  });
  it('a sweep with AC magnitude and phase on the source', () => {
    const c = parseNetlist('V1 in 0 AC 2 90\nR1 in 0 1k');
    const lay = layoutOf(c);
    const s = acSweep(c, lay, parseProbes(c, lay, 'in'), 10, 1000, 3);
    close(s.mag[0]![0]!, 2, 1e-12);
    close(s.phase[0]![0]!, 90, 1e-9);
  });
  it('refuses a bad range or count', () => {
    const c = parseNetlist('V1 in 0 AC 1\nR1 in 0 1k');
    const lay = layoutOf(c);
    const p = parseProbes(c, lay, 'in');
    expect(() => acSweep(c, lay, p, 0, 100, 10)).toThrow();
    expect(() => acSweep(c, lay, p, 100, 10, 10)).toThrow();
    expect(() => acSweep(c, lay, p, 1, 10, 1)).toThrow();
    expect(() => acSweep(c, lay, p, 1, 10, 5000)).toThrow();
  });
});

describe('transient response', () => {
  it('RC step, R 1 k, C 1 uF, 1 V: v_C(1 ms) = 0.63212', () => {
    const run = tran('V1 in 0 STEP 0 1 0\nR1 in out 1k\nC1 out 0 1u', 'out', 1e-6, 1e-3);
    near(at(run, 1e-3), 0.63212, 1e-4);
    near(at(run, 1e-3), 1 - Math.exp(-1), 1e-5);
    near(at(run, 2e-4), 1 - Math.exp(-0.2), 1e-5);
  });
  it('is still accurate with a coarse step', () => {
    const run = tran('V1 in 0 STEP 0 1 0\nR1 in out 1k\nC1 out 0 1u', 'out', 5e-5, 2e-3);
    near(at(run, 2e-3), 1 - Math.exp(-2), 2e-3);
  });
  it('RL step: i(t) = (V/R)(1 - e^(-tR/L))', () => {
    const run = tran('V1 in 0 STEP 0 1 0\nR1 in a 10\nL1 a 0 10m', 'i(L1)', 1e-6, 3e-3);
    near(at(run, 2e-3), 0.1 * (1 - Math.exp(-2)), 1e-6);
  });
  it('underdamped series RLC matches the closed form', () => {
    const [r, l, c] = [20, 10e-3, 10e-6];
    const run = tran(`V1 in 0 STEP 0 1 0\nR1 in a ${r}\nL1 a b ${l}\nC1 b 0 ${c}`, 'b', 1e-6, 4e-3);
    const alpha = r / (2 * l);
    const wd = Math.sqrt(1 / (l * c) - alpha * alpha);
    for (const t of [3e-4, 7e-4, 1.5e-3, 3e-3]) {
      const exact = 1 - Math.exp(-alpha * t) * (Math.cos(wd * t) + (alpha / wd) * Math.sin(wd * t));
      near(at(run, t), exact, 1e-3);
    }
  });
  it('an initial capacitor voltage discharges through the resistor', () => {
    const run = tran('R1 out 0 1k\nC1 out 0 1u ic=2', 'out', 1e-6, 2e-3);
    near(run.values[0]![0]!, 2, 1e-6);
    near(at(run, 1e-3), 2 * Math.exp(-1), 2e-4);
  });
  it('a switch that closes at 1 ms connects the source', () => {
    const run = tran('V1 in 0 5\nS1 in out 1m\nR1 out 0 1k', 'out', 1e-4, 2e-3);
    near(at(run, 5e-4), 0, 1e-4);
    near(at(run, 1.5e-3), 5, 1e-4);
  });
  it('a pulse source rises, holds, and falls on schedule', () => {
    const run = tran('V1 a 0 PULSE 0 1 1m 0 0 2m 5m\nR1 a 0 1k', 'a', 1e-4, 8e-3);
    near(at(run, 5e-4), 0, 1e-12);
    near(at(run, 2e-3), 1, 1e-12);
    near(at(run, 4e-3), 0, 1e-12);
    near(at(run, 7e-3), 1, 1e-12);
  });
  it('a sine source drives a resistor with the right amplitude', () => {
    const run = tran('V1 a 0 SIN 0 2 1k\nR1 a 0 1k', 'a', 1e-5, 2e-3);
    near(Math.max(...run.values[0]!), 2, 1e-9);
    near(at(run, 2.5e-4), 2, 1e-9);
  });
  it('an LC tank keeps its energy with the trapezoidal rule', () => {
    const run = tran('C1 a 0 1u ic=1\nL1 a 0 1m', 'a', 1e-6, 1e-3);
    const peak = Math.max(...run.values[0]!.slice(400));
    expect(peak).toBeGreaterThan(0.99);
    expect(peak).toBeLessThan(1.01);
  });
  it('refuses a step that is not smaller than the stop time, and too many steps', () => {
    const c = parseNetlist('V1 a 0 1\nR1 a 0 1k');
    const lay = layoutOf(c);
    const p = parseProbes(c, lay, 'a');
    expect(() => transient(c, lay, p, 2, 1)).toThrow();
    expect(() => transient(c, lay, p, 1e-9, 1)).toThrow();
  });
});

describe('sources and switches', () => {
  it('the step, pulse and sine values, and the level before time zero', () => {
    expect(valueAt({ kind: 'step', v0: 0, v1: 5, t0: 1 }, 0.5)).toBe(0);
    expect(valueAt({ kind: 'step', v0: 0, v1: 5, t0: 1 }, 1)).toBe(0);
    expect(valueAt({ kind: 'step', v0: 0, v1: 5, t0: 1 }, 1.0001)).toBe(5);
    expect(valueAt({ kind: 'step', v0: 2, v1: 5, t0: 0 }, 0, true)).toBe(2);
    const pulse = { kind: 'pulse', v1: 0, v2: 4, td: 1, tr: 1, tf: 1, pw: 2, per: 10 } as const;
    expect(valueAt(pulse, 1.5)).toBeCloseTo(2, 12);
    expect(valueAt(pulse, 3)).toBe(4);
    expect(valueAt(pulse, 4.5)).toBeCloseTo(2, 12);
    expect(valueAt(pulse, 11.5)).toBeCloseTo(2, 12);
    expect(valueAt({ kind: 'sin', off: 1, amp: 2, freq: 1, td: 0, phase: 0 }, 0.25)).toBeCloseTo(3, 12);
  });
  it('switch states and the breakpoints they make', () => {
    const c = parseNetlist('V1 a 0 PULSE 0 1 1m 1u 1u 1m 5m\nS1 a b 2m 4m\nR1 b 0 1k');
    const s = c.elements.find((e) => e.kind === 'S')!;
    expect(switchClosed(s, 1e-3)).toBe(false);
    expect(switchClosed(s, 3e-3)).toBe(true);
    expect(switchClosed(s, 5e-3)).toBe(false);
    const b = breakpoints(c.elements, 8e-3);
    expect(b).toContain(2e-3);
    expect(b).toContain(4e-3);
    expect(b).toContain(1e-3);
  });
});

describe('reading the netlist', () => {
  it('reads SI prefixes, comments, and units, and treats 0 and gnd as ground', () => {
    const c = parseNetlist('* a comment\nV1 in gnd 1meg # trailing\nR1 in 0 4.7k\nC1 in 0 10n ic=1');
    expect(c.nodes).toEqual(['in']);
    expect(c.elements[0]!.source!.shape).toEqual({ kind: 'dc', value: 1e6 });
    expect(c.elements[1]!.value).toBeCloseTo(4700, 9);
    expect(c.elements[2]!.ic).toBe(1);
  });
  it('names the line of each mistake', () => {
    const line = (text: string): string => {
      try {
        parseNetlist(text);
      } catch (error) {
        return (error as { vars: Record<string, string> }).vars.line ?? (error as { key: string }).key;
      }
      return 'no error';
    };
    expect(line('V1 a 0 1\nQ1 a 0 1')).toBe('2');
    expect(line('V1 a 0 1\nR1 a 0 x')).toBe('2');
    expect(line('V1 a 0 1\nR1 a 0 -5')).toBe('2');
    expect(line('V1 a 0 1\nR1 a 0')).toBe('2');
    expect(line('V1 a 0 1\nV1 b 0 2')).toBe('2');
    expect(line('V1 a 0 1\nF1 b 0 Vnone 2\nR1 b 0 1k')).toBe('2');
    expect(line('V1 a 0 PULSE 0 1')).toBe('1');
    expect(line('V1 a 0 BOGUS 1')).toBe('1');
    expect(line('')).toBe('netEmpty');
    expect(line('R1 a b 1k')).toBe('netNoGround');
  });
  it('reads probes', () => {
    const c = parseNetlist('V1 in 0 1\nR1 in out 1k\nR2 out 0 1k');
    const lay = layoutOf(c);
    expect(parseProbe(c, lay, 'v(out,in)').label).toBe('v(out,in)');
    expect(parseProbes(c, lay, 'out, i(R1), v(in,out)')).toHaveLength(3);
    expect(() => parseProbe(c, lay, 'nowhere')).toThrow();
    expect(() => parseProbe(c, lay, 'i(Q9)')).toThrow();
    expect(() => parseProbes(c, lay, '')).toThrow();
  });
});

describe('the simulator tool form', () => {
  const base = initialValues(spec);
  it('answers each analysis on the starting netlist and on harder ones', () => {
    for (const analysis of ['netAc', 'netTran', 'netOp', 'netThev']) {
      expect(runTool(spec, { ...base, analysis }).ok, analysis).toBe(true);
    }
    const rlc = 'V1 in 0 AC 1 0\nR1 in a 10\nL1 a b 10m\nC1 b 0 10u';
    const r = runTool(spec, { ...base, netlist: rlc, probes: 'i(V1)', acStop: '100k' });
    expect(r.ok && r.rows.some((row) => row.key === 'qualityFactor' && row.value === '3.1623')).toBe(true);
    expect(r.ok && r.plot2).toBeTruthy();
  });
  it('names the problem instead of throwing', () => {
    expect(runTool(spec, { ...base, netlist: 'R1 a 0 x' }).ok).toBe(false);
    expect(runTool(spec, { ...base, probes: 'nope' }).ok).toBe(false);
    expect(runTool(spec, { ...base, analysis: 'netThev', thevA: 'zzz' }).ok).toBe(false);
    expect(runTool(spec, { ...base, analysis: 'netThev', thevA: 'out', thevB: 'out' }).ok).toBe(false);
    expect(runTool(spec, { ...base, analysis: 'netTran', tranStep: '1n', tranStop: '1' }).ok).toBe(false);
    expect(runTool(spec, { ...base, analysis: 'netOp', netlist: 'V1 a 0 1\nV2 a 0 2' }).ok).toBe(false);
  });
});
