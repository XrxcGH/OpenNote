// The nozzle tool: a converging-diverging nozzle at any back pressure, with its regime, the three critical back
// pressures, any normal shock inside, the exit state, the mass flow, and the pressure along the nozzle.
import { AeroError } from '../common';
import { readNumber } from '../ui/spec';
import type { Row, ToolSpec, Values } from '../ui/spec';
import { nozzle } from './engine';
import type { ProfilePoint } from './engine';

const SHAPES = ['ratio', 'profile'] as const;
const byProfile = (v: Values) => v.shape === 'profile';

/** Reads "x A/At" pairs separated by semicolons or new lines, such as "-1 3; 0 1; 1 2". */
export function parseProfile(text: string): ProfilePoint[] {
  const parts = text
    .split(/[;\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts.map((part) => {
    const numbers = part.split(/[\s,]+/).map((n) => readNumber(n) ?? NaN);
    if (numbers.length !== 2 || numbers.some((n) => !Number.isFinite(n))) throw new AeroError('profileText', { part });
    return { x: numbers[0]!, A: numbers[1]! };
  });
}

export const spec: ToolSpec = {
  id: 'nozzle',
  fields: [
    { id: 'shape', kind: 'choice', initial: 'ratio', options: SHAPES },
    { id: 'areaRatio', kind: 'number', initial: '2', when: (v) => !byProfile(v) },
    { id: 'profile', kind: 'text', initial: '-1 3; -0.5 1.75; 0 1; 0.5 1.5; 1 2', wide: true, when: byProfile },
    { id: 'throat', kind: 'quantity', qty: 'area', initial: '0.0001' },
    { id: 'p0', kind: 'quantity', qty: 'pressure', initial: '500000' },
    { id: 'T0', kind: 'quantity', qty: 'temperature', initial: '600' },
    { id: 'pb', kind: 'quantity', qty: 'pressure', initial: '350000' },
    { id: 'gamma', kind: 'number', initial: '1.4' },
    { id: 'R', kind: 'quantity', qty: 'gasConstant', initial: '287' },
  ],
  run(inputs) {
    const tabulated = byProfile(inputs.values);
    const r = nozzle({
      areaRatio: tabulated ? NaN : inputs.n('areaRatio'),
      ...(tabulated ? { profile: parseProfile(inputs.s('profile')) } : {}),
      throat: inputs.q('throat'),
      p0: inputs.q('p0'),
      T0: inputs.q('T0'),
      pb: inputs.q('pb'),
      gamma: inputs.n('gamma'),
      R: inputs.q('R'),
    });
    const [c1, c2, c3] = r.critical;
    const rows: Row[] = [
      { id: 'pbp0', value: r.pbp0, sig: 6 },
      { id: 'c1', value: c1, sig: 6 },
      { id: 'c2', value: c2, sig: 6 },
      { id: 'c3', value: c3, sig: 6 },
      { id: 'Me', value: r.exitMach, sig: 6, answer: true },
      { id: 'pe', value: r.exitPressure, qty: 'pressure', sig: 6, answer: true },
      { id: 'Te', value: r.exitTemperature, qty: 'temperature', sig: 6 },
      { id: 'Ve', value: r.exitVelocity, qty: 'speed', sig: 6 },
      { id: 'mdot', value: r.massFlow, qty: 'massFlow', sig: 6, answer: true },
    ];
    if (r.shock) {
      rows.push(
        { id: 'As', value: r.shock.areaRatio, sig: 6, answer: true },
        { id: tabulated ? 'xsProfile' : 'xs', value: r.shock.x, sig: 4 },
        { id: 'M1', value: r.shock.M1, sig: 6 },
        { id: 'p02p01', value: r.shock.p02p01, sig: 6 },
      );
    }
    // The shock is marked at the pressure just ahead of it, where the jump starts.
    const ahead = r.shock ? [...r.plot.p].reverse().find((p) => p.x <= r.shock!.x) : undefined;
    const shockMark = r.shock && ahead ? [{ x: r.shock.x, y: ahead.y, label: 'shock' }] : [];
    const solve = r.steps.find((s) => s.key === 'nzShockSolve') ?? r.steps.find((s) => s.key === 'nzMassFlow');
    return {
      headline: { key: `regime.${r.regime}` },
      rows,
      steps: r.steps,
      ...(solve?.math ? { latex: solve.math } : {}),
      plots: [
        {
          title: 'pressure',
          x: tabulated ? 'xProfile' : 'x',
          y: 'pp0',
          series: [{ label: 'pp0', points: r.plot.p }],
          marks: [...shockMark, { x: r.plot.p[r.plot.p.length - 1]!.x, y: r.pbp0, label: 'back' }],
        },
        {
          title: 'area',
          x: tabulated ? 'xProfile' : 'x',
          y: 'AAt',
          series: [{ label: 'AAt', points: r.plot.area }],
        },
      ],
    };
  },
};
