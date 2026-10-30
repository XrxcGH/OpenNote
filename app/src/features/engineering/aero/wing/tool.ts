// The finite wing tool: lift, induced drag, and span efficiency of a tapered or elliptic wing by lifting-line theory,
// with the spanwise load against the elliptic one, and forces when a flight condition is given.
import { DEG } from '../common';
import type { Row, ToolSpec } from '../ui/spec';
import { wing } from './engine';

/** Angles arrive in radians, the SI base; the engine takes degrees. */
const degrees = (radians: number) => radians / DEG;

export const spec: ToolSpec = {
  id: 'wing',
  fields: [
    { id: 'planform', kind: 'choice', initial: 'tapered', options: ['tapered', 'elliptic'] },
    { id: 'span', kind: 'quantity', qty: 'length', initial: '12' },
    { id: 'area', kind: 'quantity', qty: 'area', initial: '24' },
    { id: 'taper', kind: 'number', initial: '1', when: (v) => (v.planform ?? 'tapered') === 'tapered' },
    { id: 'twist', kind: 'quantity', qty: 'angle', initial: '0' },
    { id: 'a0', kind: 'number', initial: '2*pi' },
    { id: 'alphaL0', kind: 'quantity', qty: 'angle', initial: '0' },
    { id: 'alpha', kind: 'quantity', qty: 'angle', initial: '5' },
    { id: 'terms', kind: 'number', initial: '40' },
    { id: 'V', kind: 'quantity', qty: 'speed', initial: '', optional: true },
    { id: 'rho', kind: 'quantity', qty: 'density', initial: '1.225', optional: true },
  ],
  run(inputs) {
    const V = inputs.qOpt('V');
    const rho = inputs.qOpt('rho');
    const r = wing({
      planform: inputs.c('planform') === 'elliptic' ? 'elliptic' : 'tapered',
      span: inputs.q('span'),
      area: inputs.q('area'),
      taper: inputs.n('taper'),
      twist: degrees(inputs.q('twist')),
      a0: inputs.n('a0'),
      alphaL0: degrees(inputs.q('alphaL0')),
      alpha: degrees(inputs.q('alpha')),
      terms: inputs.n('terms'),
      ...(V !== undefined && rho !== undefined ? { V, rho } : {}),
    });
    const rows: Row[] = [
      { id: 'AR', value: r.AR, sig: 5 },
      { id: 'CL', value: r.CL, sig: 5, answer: true },
      { id: 'CDi', value: r.CDi, sig: 5, answer: true },
      { id: 'e', value: r.e, sig: 5, answer: true },
      { id: 'delta', value: r.delta, sig: 4 },
      { id: 'a', value: r.a, sig: 5, unit: 'per rad' },
      { id: 'aDeg', value: r.a * DEG, sig: 5, unit: 'per degree' },
      { id: 'alphaL0Wing', value: r.alphaL0Wing, sig: 5, unit: '°' },
      { id: 'A1', value: r.A[0] ?? NaN, sig: 6 },
    ];
    if (r.lift !== undefined && r.drag !== undefined) {
      rows.push(
        { id: 'lift', value: r.lift, qty: 'force', sig: 5, answer: true },
        { id: 'drag', value: r.drag, qty: 'force', sig: 5 },
      );
    }
    const cdi = r.steps.find((s) => s.key === 'wgCDi');
    return {
      rows,
      steps: r.steps,
      ...(cdi?.math ? { latex: cdi.math } : {}),
      plots: [
        {
          title: 'load',
          x: 'y',
          y: 'loadAxis',
          series: [
            { label: 'load', points: r.plot.load },
            { label: 'elliptic', points: r.plot.elliptic, style: 'dashed' },
          ],
        },
        { title: 'cl', x: 'y', y: 'clAxis', series: [{ label: 'cl', points: r.plot.cl }] },
      ],
    };
  },
};
