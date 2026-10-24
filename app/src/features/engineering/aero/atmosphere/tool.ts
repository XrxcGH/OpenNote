// The standard atmosphere tool: the state at an altitude, or the altitude for a pressure, density or temperature.
import type { XY } from '../common';
import type { PlotSpec, ToolSpec, Values } from '../ui/spec';
import { SOURCES, atmosphere } from './engine';
import type { AtmosphereMode } from './engine';

const mode = (values: Values) => values.mode ?? 'altitude';

/** Altitude goes up the page, as atmosphere charts are drawn. */
const upward = (points: readonly XY[]): XY[] => points.map((p) => ({ x: p.y, y: p.x }));

export const spec: ToolSpec = {
  id: 'atmosphere',
  sources: SOURCES,
  fields: [
    { id: 'mode', kind: 'choice', initial: 'altitude', options: ['altitude', 'pressure', 'density', 'temperature'] },
    { id: 'altitude', kind: 'quantity', qty: 'altitude', initial: '11000', when: (v) => mode(v) === 'altitude' },
    {
      id: 'kind',
      kind: 'choice',
      initial: 'geopotential',
      options: ['geometric', 'geopotential'],
      when: (v) => mode(v) === 'altitude',
    },
    { id: 'pressure', kind: 'quantity', qty: 'pressure', initial: '54019.9', when: (v) => mode(v) === 'pressure' },
    { id: 'density', kind: 'quantity', qty: 'density', initial: '0.736116', when: (v) => mode(v) === 'density' },
    {
      id: 'temperature',
      kind: 'quantity',
      qty: 'temperature',
      initial: '255.65',
      when: (v) => mode(v) === 'temperature',
    },
    { id: 'dT', kind: 'quantity', qty: 'tempDiff', initial: '0' },
  ],
  run(inputs) {
    const chosen = inputs.c('mode') as AtmosphereMode;
    const dT = inputs.q('dT');
    const r =
      chosen === 'altitude'
        ? atmosphere({
            mode: 'altitude',
            altitude: inputs.q('altitude'),
            kind: inputs.c('kind') === 'geometric' ? 'geometric' : 'geopotential',
            dT,
          })
        : atmosphere({ mode: chosen, value: inputs.q(chosen), dT });
    const Hkm = r.H / 1000;
    const plot = (title: string, x: string, points: readonly XY[], value: number): PlotSpec => ({
      title,
      x,
      y: 'H',
      series: [{ label: 'standard', points: upward(points) }],
      marks: [{ x: value, y: Hkm, label: 'here' }],
      ...(title === 'pTitle' ? { logX: true } : {}),
    });
    const pressureStep = r.steps.find((s) => s.key === 'atmPressureIso' || s.key === 'atmPressureLapse');
    return {
      rows: [
        { id: 'layer', word: `@layer.${r.layer}` },
        { id: 'z', value: r.z, qty: 'altitude', sig: 6 },
        { id: 'H', value: r.H, qty: 'altitude', sig: 6 },
        { id: 'T', value: r.T, qty: 'temperature', sig: 6, answer: true },
        { id: 'p', value: r.p, qty: 'pressure', sig: 6, answer: true },
        { id: 'rho', value: r.rho, qty: 'density', sig: 6, answer: true },
        { id: 'a', value: r.a, qty: 'speed', sig: 6, answer: true },
        { id: 'mu', value: r.mu, qty: 'viscosity', sig: 5 },
        { id: 'nu', value: r.nu, qty: 'kinematic', sig: 5 },
        { id: 'g', value: r.g, qty: 'accel', sig: 6 },
        { id: 'theta', value: r.theta, sig: 6 },
        { id: 'delta', value: r.delta, sig: 6 },
        { id: 'sigma', value: r.sigma, sig: 6 },
      ],
      steps: r.steps,
      ...(pressureStep?.math ? { latex: pressureStep.math } : {}),
      plots: [
        plot('tTitle', 'T', r.plot.T, r.T),
        plot('pTitle', 'p', r.plot.p, r.p / 1000),
        plot('rhoTitle', 'rho', r.plot.rho, r.rho),
      ],
    };
  },
};
