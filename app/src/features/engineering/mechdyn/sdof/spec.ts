// The single-degree-of-freedom vibration tool's form and results: mass, spring, and damper, the starting state,
// and a forcing (none, a harmonic force, base motion, a rotating unbalance, an impulse, or any F(t)).
import { unwrap } from '../kit/errors';
import { q } from '../kit/format';
import { num, str, type ResultRow, type ToolSpec } from '../kit/spec';
import { solveSdof, type SdofForcing } from './engine';

const HARMONIC = new Set(['harmonic', 'base', 'unbalance']);

export const sdofSpec: ToolSpec = {
  fields: [
    { id: 'm', type: 'quantity', kind: 'mass', first: '10 kg' },
    { id: 'k', type: 'quantity', kind: 'stiffness', first: '4000 N/m' },
    { id: 'damping', type: 'choice', options: ['c', 'zeta'], first: 'c' },
    { id: 'c', type: 'quantity', kind: 'damping', first: '40 N*s/m', when: (v) => v.damping === 'c' },
    { id: 'zeta', type: 'quantity', kind: 'ratio', first: '0.1', when: (v) => v.damping === 'zeta' },
    { id: 'x0', type: 'quantity', kind: 'small', first: '10 mm' },
    { id: 'v0', type: 'quantity', kind: 'velocity', first: '0 m/s' },
    {
      id: 'forcing',
      type: 'choice',
      options: ['free', 'harmonic', 'base', 'unbalance', 'impulse', 'custom'],
      first: 'free',
    },
    { id: 'F0', type: 'quantity', kind: 'force', first: '100 N', when: (v) => v.forcing === 'harmonic' },
    {
      id: 'omega',
      type: 'quantity',
      kind: 'angularSpeed',
      first: '15 rad/s',
      when: (v) => HARMONIC.has(String(v.forcing)),
    },
    { id: 'Y', type: 'quantity', kind: 'small', first: '5 mm', when: (v) => v.forcing === 'base' },
    { id: 'me', type: 'quantity', kind: 'unbalance', first: '0.01 kg*m', when: (v) => v.forcing === 'unbalance' },
    { id: 'impulse', type: 'quantity', kind: 'impulse', first: '1 N*s', when: (v) => v.forcing === 'impulse' },
    { id: 'custom', type: 'text', first: '100*sin(15*t)', hint: true, when: (v) => v.forcing === 'custom' },
    { id: 'duration', type: 'quantity', kind: 'time', first: '', optional: true, hint: true },
  ],
  examples: [
    { id: 'free', values: {} },
    { id: 'harmonic', values: { forcing: 'harmonic', x0: '0 mm', F0: '100 N', omega: '15 rad/s' } },
    { id: 'isolation', values: { damping: 'zeta', zeta: '0.1', forcing: 'base', x0: '0 mm', omega: '40 rad/s' } },
    { id: 'critical', values: { damping: 'zeta', zeta: '1' } },
  ],
  run(values) {
    const forcing = str(values, 'forcing') as SdofForcing;
    const duration = num(values, 'duration');
    const r = unwrap(
      solveSdof({
        m: num(values, 'm'),
        k: num(values, 'k'),
        damping: str(values, 'damping') === 'zeta' ? 'zeta' : 'c',
        c: str(values, 'damping') === 'c' ? num(values, 'c') : 0,
        zeta: str(values, 'damping') === 'zeta' ? num(values, 'zeta') : 0,
        x0: num(values, 'x0'),
        v0: num(values, 'v0'),
        forcing,
        F0: forcing === 'harmonic' ? num(values, 'F0') : 0,
        omega: HARMONIC.has(forcing) ? num(values, 'omega') : 0,
        Y: forcing === 'base' ? num(values, 'Y') : 0,
        me: forcing === 'unbalance' ? num(values, 'me') : 0,
        impulse: forcing === 'impulse' ? num(values, 'impulse') : 0,
        custom: str(values, 'custom'),
        duration: Number.isFinite(duration) ? duration : 0,
      }),
    );
    const rows: ResultRow[] = [
      { id: 'omegaN', value: q(r.omegaN, 'angularSpeed'), sym: '\\omega_n', answer: true },
      { id: 'fn', value: q(r.fn, 'frequency'), sym: 'f_n' },
      { id: 'period', value: q(r.period, 'time'), sym: '\\tau_n' },
      { id: 'cc', value: q(r.cc, 'damping'), sym: 'c_c' },
      { id: 'c', value: q(r.c, 'damping'), sym: 'c' },
      { id: 'zeta', value: r.zeta, sym: '\\zeta', answer: true },
      { id: 'regime', word: r.regime },
    ];
    if (r.omegaD !== null) rows.push({ id: 'omegaD', value: q(r.omegaD, 'angularSpeed'), sym: '\\omega_d' });
    if (r.logDec !== null) rows.push({ id: 'logDec', value: r.logDec, sym: '\\delta' });
    if (r.logDecMeasured !== null) rows.push({ id: 'logDecMeasured', value: r.logDecMeasured });
    const f = r.forced;
    if (f) {
      rows.push(
        { id: 'r', value: f.r, sym: 'r' },
        { id: 'X', value: q(f.X, 'small'), sym: 'X', answer: true },
        { id: 'phase', value: q(f.phase, 'angle'), sym: '\\phi', answer: true },
        { id: 'magnification', value: f.magnification },
        { id: 'transmissibility', value: f.transmissibility, sym: 'TR' },
      );
      if (f.isolation !== null) rows.push({ id: 'isolation', value: q(f.isolation, 'percent') });
      if (f.transmitted !== null) rows.push({ id: 'transmitted', value: q(f.transmitted, 'force') });
      if (f.relative !== null) rows.push({ id: 'relative', value: q(f.relative, 'small'), sym: 'Z' });
    }
    rows.push({ id: 'peak', value: q(r.peak, 'small') });
    const notes = ['linear', 'sign', HARMONIC.has(forcing) ? 'steady' : 'response'];
    return { rows, steps: r.steps, notes, plots: r.frequency ? [r.response, r.frequency] : [r.response] };
  },
};
