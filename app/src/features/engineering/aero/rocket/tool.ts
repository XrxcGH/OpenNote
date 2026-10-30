// The rocket tool: ideal performance from the chamber state and the nozzle, with thrust against altitude and,
// given a mass ratio, the ideal velocity change.
import type { Row, ToolSpec, Values } from '../ui/spec';
import { rocket } from './engine';
import type { ExitMode } from './engine';

const MODES: readonly ExitMode[] = ['areaRatio', 'exitPressure', 'optimum'];
const mode = (values: Values): ExitMode => (MODES.find((m) => m === values.mode) ?? 'areaRatio') as ExitMode;

export const spec: ToolSpec = {
  id: 'rocket',
  fields: [
    { id: 'Tc', kind: 'quantity', qty: 'temperature', initial: '3500' },
    { id: 'molarMass', kind: 'quantity', qty: 'molarMass', initial: '22' },
    { id: 'gamma', kind: 'number', initial: '1.2' },
    { id: 'pc', kind: 'quantity', qty: 'pressure', initial: '7000000' },
    { id: 'mode', kind: 'choice', initial: 'areaRatio', options: MODES },
    { id: 'areaRatio', kind: 'number', initial: '40', when: (v) => mode(v) === 'areaRatio' },
    { id: 'pe', kind: 'quantity', qty: 'pressure', initial: '14610', when: (v) => mode(v) === 'exitPressure' },
    { id: 'pa', kind: 'quantity', qty: 'pressure', initial: '0' },
    { id: 'throat', kind: 'quantity', qty: 'area', initial: '0.01' },
    { id: 'massRatio', kind: 'number', initial: '3', optional: true },
  ],
  run(inputs) {
    const chosen = mode(inputs.values);
    const massRatio = inputs.nOpt('massRatio');
    const r = rocket({
      Tc: inputs.q('Tc'),
      // Quantities arrive in SI base units, kg/mol here; the engine takes kg/kmol.
      molarMass: inputs.q('molarMass') * 1000,
      gamma: inputs.n('gamma'),
      pc: inputs.q('pc'),
      mode: chosen,
      ...(chosen === 'areaRatio' ? { areaRatio: inputs.n('areaRatio') } : {}),
      ...(chosen === 'exitPressure' ? { pe: inputs.q('pe') } : {}),
      pa: inputs.q('pa'),
      throat: inputs.q('throat'),
      ...(massRatio === undefined ? {} : { massRatio }),
    });
    const rows: Row[] = [
      { id: 'cStar', value: r.cStar, qty: 'speed', sig: 6, answer: true },
      { id: 'Me', value: r.exitMach, sig: 6 },
      { id: 'eps', value: r.areaRatio, sig: 6 },
      { id: 'pe', value: r.pe, qty: 'pressure', sig: 6 },
      { id: 'Te', value: r.Te, qty: 'temperature', sig: 6 },
      { id: 'ue', value: r.exitVelocity, qty: 'speed', sig: 6 },
      { id: 'CFm', value: r.CFmomentum, sig: 6 },
      { id: 'CFp', value: r.CFpressure, sig: 6 },
      { id: 'CF', value: r.CF, sig: 6, answer: true },
      { id: 'Isp', value: r.Isp, qty: 'time', sig: 6, answer: true },
      { id: 'c', value: r.c, qty: 'speed', sig: 6 },
      { id: 'thrust', value: r.thrust, qty: 'force', sig: 6, answer: true },
      { id: 'mdot', value: r.massFlow, qty: 'massFlow', sig: 6 },
      { id: 'R', value: r.R, qty: 'gasConstant', sig: 6 },
    ];
    if (r.deltaV !== undefined) rows.push({ id: 'deltaV', value: r.deltaV, qty: 'speed', sig: 6, answer: true });
    const isp = r.steps.find((s) => s.key === 'rkCF');
    return {
      ...(r.separationRisk ? { headline: { key: 'n.separation' } } : {}),
      rows,
      steps: r.steps,
      ...(isp?.math ? { latex: isp.math } : {}),
      plots: [
        {
          title: 'altitude',
          x: 'H',
          y: 'F',
          xUnit: { qty: 'altitude', si: 'km' },
          yUnit: { qty: 'force', si: 'kN' },
          // The engine samples altitude in km.
          series: [{ label: 'F', points: r.plot.map((p) => ({ x: p.x * 1000, y: p.y })) }],
        },
      ],
    };
  },
};
