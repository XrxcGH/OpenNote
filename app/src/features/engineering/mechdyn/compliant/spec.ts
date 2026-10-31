// The compliant mechanisms tool's form and results: a flexure (a cantilever, a fixed-guided beam, or a short
// flexural pivot with a rigid link), its section and material, and the end load, solved exactly (the elastica) and by
// the pseudo-rigid-body model, side by side.
import { unwrap } from '../kit/errors';
import { q } from '../kit/format';
import { num, str, type ResultRow, type ToolSpec } from '../kit/spec';
import { SOURCES, solveCompliant, type FlexureType } from './engine';

export const compliantSpec: ToolSpec = {
  fields: [
    { id: 'type', type: 'choice', options: ['cantilever', 'fixedGuided', 'pivot'], first: 'cantilever' },
    { id: 'length', type: 'quantity', kind: 'small', first: '50 mm' },
    { id: 'rigidLength', type: 'quantity', kind: 'small', first: '40 mm', when: (v) => v.type === 'pivot' },
    { id: 'E', type: 'quantity', kind: 'modulus', first: '1.4 GPa' },
    { id: 'width', type: 'quantity', kind: 'small', first: '6 mm' },
    { id: 'thickness', type: 'quantity', kind: 'small', first: '1 mm' },
    { id: 'force', type: 'quantity', kind: 'force', first: '1 N' },
    { id: 'forceAngle', type: 'quantity', kind: 'angle', first: '90', hint: true },
    { id: 'moment', type: 'quantity', kind: 'smallMoment', first: '0 N*mm', when: (v) => v.type !== 'fixedGuided' },
  ],
  examples: [
    { id: 'index2', values: { force: '0.56 N' } },
    { id: 'guided', values: { type: 'fixedGuided', force: '2 N' } },
    { id: 'pivot', values: { type: 'pivot', length: '5 mm', rigidLength: '45 mm', force: '0.2 N' } },
  ],
  run(values) {
    const type = str(values, 'type') as FlexureType;
    const L = num(values, 'length');
    const r = unwrap(
      solveCompliant({
        type,
        length: L,
        E: num(values, 'E'),
        width: num(values, 'width'),
        thickness: num(values, 'thickness'),
        force: num(values, 'force'),
        forceAngle: num(values, 'forceAngle'),
        moment: type === 'fixedGuided' ? 0 : num(values, 'moment'),
        rigidLength: type === 'pivot' ? num(values, 'rigidLength') : 0,
      }),
    );
    const reach = type === 'pivot' ? L + num(values, 'rigidLength') : L;
    const rows: ResultRow[] = [
      { id: 'I', value: q(r.I, 'areaInertia'), sym: 'I' },
      { id: 'EI', value: q(r.EI, 'flexuralRigidity'), sym: 'EI' },
      { id: 'loadIndex', value: r.loadIndex, sym: 'PL^2/EI' },
      { id: 'exactA', value: q(r.exact.a, 'small'), sym: 'a', answer: true },
      { id: 'exactB', value: q(r.exact.b, 'small'), sym: 'b', answer: true },
      { id: 'exactAL', value: r.exact.a / reach, sym: 'a/L' },
      { id: 'exactBL', value: r.exact.b / reach, sym: 'b/L' },
      { id: 'exactTheta', value: q(r.exact.theta, 'angle'), sym: '\\theta_0', answer: true },
      { id: 'rootMoment', value: q(r.exact.rootMoment, 'smallMoment'), sym: 'M_0' },
      { id: 'K', value: q(r.prbm.K, 'torsionStiffness'), sym: 'K' },
      { id: 'Theta', value: q(r.prbm.Theta, 'angle'), sym: '\\Theta' },
      { id: 'prbmA', value: q(r.prbm.a, 'small') },
      { id: 'prbmB', value: q(r.prbm.b, 'small') },
      { id: 'prbmAL', value: r.prbm.a / reach },
      { id: 'prbmBL', value: r.prbm.b / reach },
      { id: 'prbmTheta', value: q(r.prbm.endAngle, 'angle') },
      { id: 'positionError', value: q(r.positionError, 'percent') },
      { id: 'bending', value: q(r.stress.bending, 'stress') },
      { id: 'axial', value: q(r.stress.axial, 'stress') },
      { id: 'stress', value: q(r.stress.max, 'stress'), sym: '\\sigma_{max}', answer: true },
    ];
    const prbm = r.prbm.constants === 'moment' ? 'prbmMoment' : 'prbm';
    const notes = ['elastic', 'sign', r.prbm.inRange ? prbm : `${prbm}Range`];
    if (r.buckled) notes.push('buckled');
    return { rows, steps: r.steps, notes, plots: [r.shape], sources: SOURCES };
  },
};
