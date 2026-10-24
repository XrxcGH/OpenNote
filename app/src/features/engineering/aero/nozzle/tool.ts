// The nozzle tool: a converging-diverging nozzle at any back pressure, with its regime, the three critical back
// pressures, any normal shock inside, the exit state, the mass flow, and the pressure along the nozzle.
import type { Row, ToolSpec } from '../ui/spec';
import { nozzle } from './engine';

export const spec: ToolSpec = {
  id: 'nozzle',
  fields: [
    { id: 'areaRatio', kind: 'number', initial: '2' },
    { id: 'throat', kind: 'quantity', qty: 'area', initial: '0.0001' },
    { id: 'p0', kind: 'quantity', qty: 'pressure', initial: '500000' },
    { id: 'T0', kind: 'quantity', qty: 'temperature', initial: '600' },
    { id: 'pb', kind: 'quantity', qty: 'pressure', initial: '350000' },
    { id: 'gamma', kind: 'number', initial: '1.4' },
    { id: 'R', kind: 'quantity', qty: 'gasConstant', initial: '287' },
  ],
  run(inputs) {
    const r = nozzle({
      areaRatio: inputs.n('areaRatio'),
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
        { id: 'xs', value: r.shock.x, sig: 4 },
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
          x: 'x',
          y: 'pp0',
          series: [{ label: 'pp0', points: r.plot.p }],
          marks: [...shockMark, { x: 1, y: r.pbp0, label: 'back' }],
        },
        { title: 'area', x: 'x', y: 'AAt', series: [{ label: 'AAt', points: r.plot.area }] },
      ],
    };
  },
};
