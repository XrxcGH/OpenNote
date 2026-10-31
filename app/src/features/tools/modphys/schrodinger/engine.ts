// Quantum wells, barriers, and wave packets: bound states of preset or typed potentials beside the exact levels,
// expectation values, scattering from steps and barriers, transfer matrices, wave packets in time, and quantum dots.
// Lengths are in nm, energies in eV, and masses in electron masses.
import { fixed } from '../shared/calc';
import type { Calc, Item, Step } from '../shared/calc';
import { fail, positive } from '../shared/errors';
import { fmt, tex } from '../shared/format';
import type { Level, Series } from '../shared/plot';
import { AIRY_ZEROS, barrier, finiteWell, gamow, quantumDot, step, transfer, wkbRectangle } from './analytic';
import type { Layer } from './analytic';
import { runPacket } from './packet';
import type { PacketSetup } from './packet';
import { HB2M, eigenstates, expectation, grid, probabilityIn, typedPotential } from './solver';

export type QKey =
  | 'level'
  | 'boundStates'
  | 'meanX'
  | 'spreadX'
  | 'meanP2'
  | 'product'
  | 'kinetic'
  | 'region'
  | 'hamiltonian'
  | 'wellPlot'
  | 'xAxis'
  | 'eAxis'
  | 'transmission'
  | 'reflection'
  | 'k'
  | 'kappa'
  | 'wkb'
  | 'tPlot'
  | 'energyAxis'
  | 'tAxis'
  | 'transmitted'
  | 'reflected'
  | 'norm'
  | 'packetMean'
  | 'k0'
  | 'current'
  | 'crossed'
  | 'packetPlot'
  | 'densityAxis'
  | 'dotEnergy'
  | 'gamowEta'
  | 'gamowFactor';

export type Preset = 'infinite' | 'finite' | 'harmonic' | 'double' | 'morse' | 'linear' | 'delta' | 'typed';

export interface WellInput {
  preset: Preset;
  /** Width (nm), depth or height (eV), ħω (eV), Morse α (nm⁻¹), field (eV/nm), delta strength (eV nm). */
  width: number;
  depth: number;
  hw: number;
  alpha: number;
  force: number;
  strength: number;
  typed: string;
  lo: number;
  hi: number;
  massRatio: number;
  points: number;
  levels: number;
  /** A region [a, b] for the ground-state probability; NaN to skip. */
  a: number;
  b: number;
}

/** The domain, potential, and exact levels (when known) of a preset. */
function setup(w: WellInput): { lo: number; hi: number; v: (x: number) => number; exact: number[]; cell?: boolean } {
  const c = HB2M / w.massRatio;
  const n = w.levels;
  switch (w.preset) {
    case 'infinite': {
      positive(w.width, 'width');
      return {
        lo: 0,
        hi: w.width,
        v: () => 0,
        exact: Array.from({ length: n }, (_, k) => ((k + 1) ** 2 * Math.PI ** 2 * c) / w.width ** 2),
      };
    }
    case 'finite': {
      const { energies } = finiteWell(w.depth, w.width, w.massRatio);
      const span = w.width / 2 + 8 * Math.sqrt(c / w.depth);
      return { lo: -span, hi: span, v: (x) => (Math.abs(x) <= w.width / 2 ? 0 : w.depth), exact: energies, cell: true };
    }
    case 'harmonic': {
      positive(w.hw, 'hw');
      const x0 = Math.sqrt((2 * c) / w.hw);
      const span = (Math.sqrt(2 * n + 1) + 6) * x0;
      return {
        lo: -span,
        hi: span,
        v: (x) => (w.hw * w.hw * x * x) / (4 * c),
        exact: Array.from({ length: n }, (_, k) => w.hw * (k + 0.5)),
      };
    }
    case 'double': {
      positive(w.width, 'width');
      positive(w.depth, 'depth');
      const a = w.width / 2;
      return { lo: -3 * a, hi: 3 * a, v: (x) => w.depth * ((x / a) ** 2 - 1) ** 2, exact: [] };
    }
    case 'morse': {
      positive(w.depth, 'depth');
      positive(w.alpha, 'alpha');
      const hw0 = 2 * w.alpha * Math.sqrt(c * w.depth);
      const exact: number[] = [];
      for (let k = 0; k < n; k += 1) {
        const e = hw0 * (k + 0.5) - (hw0 * (k + 0.5)) ** 2 / (4 * w.depth);
        if (hw0 * (k + 0.5) < 2 * w.depth) exact.push(e);
      }
      return {
        lo: -2 / w.alpha,
        hi: 12 / w.alpha,
        v: (x) => w.depth * (1 - Math.exp(-w.alpha * x)) ** 2,
        exact,
      };
    }
    case 'linear': {
      positive(w.force, 'force');
      const scale = Math.cbrt(c / w.force);
      const top = AIRY_ZEROS[Math.min(n, AIRY_ZEROS.length) - 1]!;
      return {
        lo: 0,
        hi: (top + 8) * scale,
        v: (x) => w.force * x,
        exact: AIRY_ZEROS.slice(0, n).map((z) => z * Math.cbrt(c * w.force * w.force)),
      };
    }
    case 'delta': {
      positive(w.strength, 'strength');
      const span = 12 * ((2 * c) / w.strength);
      return { lo: -span, hi: span, v: () => 0, exact: [-(w.strength ** 2) / (4 * c)] };
    }
    case 'typed': {
      const v = typedPotential(w.typed);
      return { lo: w.lo, hi: w.hi, v, exact: [] };
    }
  }
}

/** Bound states of a well by finite differences, beside the exact levels, with the ground state's expectations. */
export function wellStates(w: WellInput): Calc<QKey> {
  positive(w.massRatio, 'massRatio');
  if (!Number.isInteger(w.levels) || w.levels < 1 || w.levels > 12) fail('badLevelsCount');
  const s = setup(w);
  const g = grid(s.lo, s.hi, w.points);
  const v = Float64Array.from(g.x, s.v);
  if (s.cell) {
    // Average the step over each grid cell, which keeps the second-order accuracy across the well's edges.
    const edge = w.width / 2;
    g.x.forEach((xi, i) => {
      const inside = Math.max(0, Math.min(xi + g.h / 2, edge) - Math.max(xi - g.h / 2, -edge));
      v[i] = w.depth * (1 - inside / g.h);
    });
  }
  if (w.preset === 'delta') {
    let nearest = 0;
    g.x.forEach((xi, i) => {
      if (Math.abs(xi) < Math.abs(g.x[nearest]!)) nearest = i;
    });
    v[nearest] = -w.strength / g.h;
  }
  const boundTop =
    w.preset === 'finite' ? w.depth : w.preset === 'morse' ? w.depth : w.preset === 'delta' ? 0 : Infinity;
  const states = eigenstates(g, v, w.massRatio, w.levels).filter((one) => one.energy < boundTop);
  if (states.length === 0) fail('noBoundState');
  const ex = expectation(g, v, states[0]!, w.massRatio);
  const items: Item<QKey>[] = states.map((one, k) => {
    const exact = s.exact[k];
    return {
      key: 'level',
      value: one.energy,
      unit: 'eV',
      text:
        `E${k + 1} = ${fmt(one.energy, 7)} eV` +
        (exact === undefined ? '' : ` (exact ${fmt(exact, 7)}, difference ${fmt(one.energy - exact, 2)})`),
    };
  });
  if (w.preset === 'finite') items.push(fixed('boundStates', s.exact.length, '', 3));
  items.push(
    fixed('meanX', ex.x, 'nm', 6),
    fixed('spreadX', ex.dx, 'nm', 6),
    fixed('meanP2', ex.p2, 'ħ²/nm²', 6),
    fixed('product', ex.product, 'ħ', 5),
    fixed('kinetic', ex.kinetic, 'eV', 6),
  );
  if (Number.isFinite(w.a) && Number.isFinite(w.b))
    items.push(fixed('region', probabilityIn(g, states[0]!, Math.min(w.a, w.b), Math.max(w.a, w.b)), '', 5));
  const steps: Step<QKey>[] = [
    {
      key: 'hamiltonian',
      text:
        `H ψᵢ = −(ħ²/2m)(ψᵢ₊₁ − 2ψᵢ + ψᵢ₋₁)/h² + Vᵢψᵢ on ${w.points} points from ${fmt(s.lo)} to ${fmt(s.hi)} nm, ` +
        `h = ${fmt(g.h)} nm, ħ²/2m = ${fmt(HB2M / w.massRatio, 6)} eV nm²; Sturm bisection gives the eigenvalues`,
      tex: `-\\frac{\\hbar^2}{2m}\\frac{\\psi_{i+1} - 2\\psi_i + \\psi_{i-1}}{h^2} + V_i\\psi_i = E\\psi_i`,
    },
    {
      key: 'product',
      text:
        `Ground state: ⟨x⟩ = ${fmt(ex.x, 6)} nm, Δx = ${fmt(ex.dx, 6)} nm, Δp = ${fmt(Math.sqrt(ex.p2), 6)} ħ/nm, Δx ` +
        `Δp = ${fmt(ex.product, 5)} ħ (at least 0.5)`,
      tex: `\\Delta x\\,\\Delta p = ${tex(ex.product, 5)}\\,\\hbar \\ge \\tfrac12\\hbar`,
    },
  ];
  const vmax = Math.max(...states.map((one) => one.energy)) * 1.4 + 0.1 * Math.abs(states[0]!.energy);
  const stride = Math.max(1, Math.floor(g.x.length / 400));
  const potential: [number, number][] = [];
  for (let i = 0; i < g.x.length; i += stride) potential.push([g.x[i]!, Math.min(v[i]!, Math.max(vmax, 0.01))]);
  const gap = states.length > 1 ? states[1]!.energy - states[0]!.energy : Math.abs(states[0]!.energy) || 1;
  const series: Series[] = [{ points: potential, kind: 'line', tone: 0, label: 'V(x)' }];
  states.slice(0, 4).forEach((one, k) => {
    const peak = Math.max(...one.psi.map(Math.abs)) || 1;
    const pts: [number, number][] = [];
    for (let i = 0; i < g.x.length; i += stride) pts.push([g.x[i]!, one.energy + (0.4 * gap * one.psi[i]!) / peak]);
    series.push({ points: pts, kind: k % 2 === 0 ? 'dash' : 'line', tone: 1 + (k % 3), label: `ψ${k + 1}` });
  });
  const levels: Level[] = states.map((one, k) => ({ y: one.energy, label: `E${k + 1}`, tone: 1 }));
  return { items, steps, plot: { title: 'wellPlot', xLabel: 'xAxis', yLabel: 'eAxis', series, levels } };
}

export type Scatter = 'step' | 'barrier' | 'well';

/** Transmission and reflection for a step, a barrier, or a well, with T against energy. */
export function scattering(kind: Scatter, e: number, v0: number, width: number, massRatio: number): Calc<QKey> {
  positive(massRatio, 'massRatio');
  positive(v0, 'height');
  const height = kind === 'well' ? -v0 : v0;
  const tOf = (en: number) =>
    kind === 'step' ? step(en, height, massRatio).t : barrier(en, height, width, massRatio).t;
  const items: Item<QKey>[] = [];
  const steps: Step<QKey>[] = [];
  if (kind === 'step') {
    const r = step(e, height, massRatio);
    items.push(fixed('transmission', r.t, '', 6), fixed('reflection', r.r, '', 6), fixed('k', r.k1, 'nm⁻¹', 6));
    steps.push({
      key: 'reflection',
      text:
        `k₁ = √(2mE)/ħ = ${fmt(r.k1, 6)} nm⁻¹, k₂ = √(2m(E − V₀))/ħ = ${fmt(r.k2, 6)} nm⁻¹; R = ((k₁ − k₂)/(k₁ + ` +
        `k₂))² = ${fmt(r.r, 6)}, T = 1 − R`,
      tex: `R = \\left(\\frac{k_1 - k_2}{k_1 + k_2}\\right)^2 = ${tex(r.r, 6)}`,
    });
  } else {
    positive(width, 'width');
    const r = barrier(e, height, width, massRatio);
    items.push(
      fixed('transmission', r.t, '', 6),
      fixed('reflection', 1 - r.t, '', 6),
      fixed('k', r.k, 'nm⁻¹', 6),
      fixed('kappa', r.kappa, 'nm⁻¹', 6),
    );
    if (kind === 'barrier' && e < v0) items.push(fixed('wkb', wkbRectangle(e, v0, width, massRatio), '', 4));
    steps.push({
      key: 'transmission',
      text:
        e < height
          ? `κ = √(2m(V₀ − E))/ħ = ${fmt(r.kappa, 6)} nm⁻¹; T = [1 + V₀² sinh²(κw) / (4E(V₀ − E))]⁻¹ = ${fmt(r.t, 6)}`
          : `k′ = √(2m(E − V₀))/ħ = ${fmt(r.kappa, 6)} nm⁻¹; T = [1 + V₀² sin²(k′w) / (4E(E − V₀))]⁻¹ = ${fmt(r.t, 6)}`,
      tex: `T = \\left[1 + \\frac{V_0^2\\sinh^2(\\kappa w)}{4E(V_0 - E)}\\right]^{-1} = ${tex(r.t, 6)}`,
    });
  }
  const top = Math.max(3 * v0, 2 * e);
  const curve: [number, number][] = Array.from({ length: 300 }, (_, i) => {
    const en = (top * (i + 1)) / 300;
    return [en, tOf(en)];
  });
  return {
    items,
    steps,
    plot: {
      title: 'tPlot',
      xLabel: 'energyAxis',
      yLabel: 'tAxis',
      series: [{ points: curve, kind: 'line', tone: 0 }],
      y: [0, 1.05],
    },
  };
}

/** Transmission through typed layers, with T against energy up to a top energy. */
export function layers(list: readonly Layer[], e: number, top: number, massRatio: number): Calc<QKey> {
  if (list.length === 0 || list.length > 50) fail('badList');
  positive(top, 'energy');
  const t = transfer(list, e, massRatio);
  const curve: [number, number][] = Array.from({ length: 400 }, (_, i) => {
    const en = (top * (i + 0.5)) / 400;
    return [en, transfer(list, en, massRatio)];
  });
  const peak = curve.reduce((best, one) => (one[1] > best[1] ? one : best), [0, 0] as [number, number]);
  return {
    items: [
      fixed('transmission', t, '', 6),
      fixed('reflection', 1 - t, '', 6),
      { key: 'tPlot', value: peak[0], unit: 'eV', text: `${fmt(peak[0], 5)} eV (T = ${fmt(peak[1], 4)})` },
    ],
    steps: [
      {
        key: 'transmission',
        text:
          `Transfer matrices: at each interface ψ and ψ′ are continuous; with no wave from the right, T = 1/|M₂₂|² = ` +
          `${fmt(t, 6)}`,
        tex: `T = \\frac{1}{|M_{22}|^2}`,
      },
    ],
    plot: {
      title: 'tPlot',
      xLabel: 'energyAxis',
      yLabel: 'tAxis',
      series: [{ points: curve, kind: 'line', tone: 0 }],
      y: [0, 1.05],
    },
  };
}

/** A Gaussian packet in time against a barrier, with transmitted and reflected probabilities. */
export function packet(s: PacketSetup): Calc<QKey> {
  const run = runPacket(s);
  const stride = Math.max(1, Math.floor(run.x.length / 400));
  const series: Series[] = run.snapshots.map((snap, k) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < run.x.length; i += stride) pts.push([run.x[i]!, snap[i]!]);
    return {
      points: pts,
      kind: (['dots', 'dash', 'line'] as const)[k] ?? 'line',
      tone: k,
      label: ['t = 0', 't/2', 't'][k] ?? '',
    };
  });
  const top = Math.max(...run.snapshots[0]!);
  if (s.width > 0 && s.v0 !== 0)
    series.push({
      points: [
        [0, 0],
        [0, top],
        [s.width, top],
        [s.width, 0],
      ],
      kind: 'line',
      tone: 3,
      label: 'barrier',
    });
  return {
    items: [
      fixed('transmitted', run.transmitted, '', 5),
      fixed('reflected', run.reflected, '', 5),
      fixed('norm', run.norm, '', 8),
      fixed('packetMean', run.meanX, 'nm', 5),
      fixed('k0', run.k0, 'nm⁻¹', 5),
      fixed('current', run.peakCurrent, 'fs⁻¹', 5),
      fixed('crossed', run.crossed, '', 5),
    ],
    steps: [
      {
        key: 'packetPlot',
        text:
          `ψ(x, 0) = exp(−(x − x₀)²/4σ²) e^(ik₀x) with k₀ = √(2mE)/ħ = ${fmt(run.k0, 5)} nm⁻¹; Crank-Nicolson with Δt ` +
          `= ${fmt(s.time / s.steps)} fs keeps the norm at ${fmt(run.norm, 8)}`,
        tex:
          `\\left(1 + \\frac{iH\\Delta t}{2\\hbar}\\right)\\psi^{n+1} = \\left(1 - \\frac{iH\\Delta ` +
          `t}{2\\hbar}\\right)\\psi^n`,
      },
      {
        key: 'current',
        text:
          `j = (ħ/m) Im(ψ* ∂ψ/∂x) at the barrier's right edge peaks at ${fmt(run.peakCurrent, 5)} fs⁻¹; ` +
          `∫ j dt = ${fmt(run.crossed, 5)} has crossed it, beside the transmitted ${fmt(run.transmitted, 5)}`,
        tex: 'j = \\frac{\\hbar}{m}\\,\\mathrm{Im}\\left(\\psi^*\\frac{\\partial\\psi}{\\partial x}\\right)',
      },
    ],
    plot: { title: 'packetPlot', xLabel: 'xAxis', yLabel: 'densityAxis', series },
  };
}

/** The ground state of a spherical quantum dot, and the Gamow factor for a charged particle leaving a nucleus. */
export function dot(radius: number, v0: number, massRatio: number): Calc<QKey> {
  positive(massRatio, 'massRatio');
  const r = quantumDot(radius, v0, massRatio);
  if (!r.bound) fail('noBoundState');
  return {
    items: [fixed('dotEnergy', r.energy, 'eV', 6)],
    steps: [
      {
        key: 'dotEnergy',
        text:
          v0 === 0
            ? `Infinite spherical well: E = π²ħ²/(2mR²) = ${fmt(r.energy, 6)} eV`
            : `l = 0: −z cot z = √(z₀² − z²) with z₀ = R√(2mV₀)/ħ; E = z²ħ²/(2mR²) = ${fmt(r.energy, 6)} eV above the bottom`,
        tex: `E = \\frac{\\pi^2\\hbar^2}{2mR^2}`,
      },
    ],
  };
}

export function gamowCalc(z1: number, z2: number, mev: number, reducedMassU: number): Calc<QKey> {
  const g = gamow(z1, z2, mev, reducedMassU);
  return {
    items: [fixed('gamowFactor', g.factor, '', 5), fixed('gamowEta', g.eta, '', 6)],
    steps: [
      {
        key: 'gamowFactor',
        text: `η = Z₁Z₂e²/(4πε₀ħv) = ${fmt(g.eta, 6)}; P ≈ e^(−2πη) = ${fmt(g.factor, 5)}`,
        tex: `P \\approx e^{-2\\pi\\eta},\\quad \\eta = \\frac{Z_1 Z_2 e^2}{4\\pi\\varepsilon_0\\hbar v}`,
      },
    ],
  };
}
