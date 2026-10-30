// The statistical thermodynamics tool's form: four modes over the engine in engine.ts.
import { choice, list, num, pick, q, type ToolSpec } from '../common/spec';
import { solveGas, solveOccupancy, solveSolid, solveSpeeds } from './engine';

export const spec: ToolSpec = {
  modes: [
    {
      id: 'gas',
      label: 'gas',
      fields: (values) => [
        pick('shape', 'shape', [
          ['linear', 'linear'],
          ['atom', 'atom'],
        ]),
        q('M', 'molarMass', 'molarM', 28.0134),
        q('T', 'temperature', 'T', 298.15),
        q('p', 'pressure', 'p', 100),
        ...(values.shape === 'atom'
          ? []
          : [
              q('B', 'rotB', 'wavenumber', 1.998),
              q('sigma', 'sigma', 'none', 2),
              { id: 'modes', label: 'modes' as const, kind: 'list' as const, initial: '2358.6' },
            ]),
        q('g0', 'g0', 'none', 1),
      ],
    },
    {
      id: 'solid',
      label: 'solid',
      fields: () => [
        pick('model', 'model', [
          ['debye', 'debye'],
          ['einstein', 'einstein'],
        ]),
        q('theta', 'theta', 'T', 343.5),
        q('T', 'temperature', 'T', 298.15),
      ],
    },
    {
      id: 'speeds',
      label: 'speeds',
      fields: () => [
        q('M', 'molarMass', 'molarM', 28.97),
        q('T', 'temperature', 'T', 300),
        q('p', 'pressure', 'p', 101.325),
        q('d', 'diameter', 'nano', 0.37),
        q('L', 'lengthScale', 'length', 0.001),
        q('cvk', 'cvk', 'none', 2.5),
      ],
    },
    {
      id: 'occupancy',
      label: 'occupancy',
      fields: () => [q('E', 'energy', 'eV', 0.05), q('mu', 'chemPotential', 'eV', 0), q('T', 'temperature', 'T', 300)],
    },
  ],
  solve(mode, values) {
    if (mode === 'solid')
      return solveSolid({ model: choice(values, 'model', 'debye'), theta: num(values, 'theta'), T: num(values, 'T') });
    if (mode === 'speeds')
      return solveSpeeds({
        M: num(values, 'M'),
        T: num(values, 'T'),
        p: num(values, 'p'),
        d: num(values, 'd'),
        L: num(values, 'L'),
        cvk: num(values, 'cvk'),
      });
    if (mode === 'occupancy')
      return solveOccupancy({ E: num(values, 'E'), mu: num(values, 'mu'), T: num(values, 'T') });
    const shape = choice<'atom' | 'linear'>(values, 'shape', 'linear');
    return solveGas({
      shape,
      M: num(values, 'M'),
      T: num(values, 'T'),
      p: num(values, 'p'),
      B: shape === 'atom' ? 0 : num(values, 'B'),
      sigma: shape === 'atom' ? 1 : num(values, 'sigma'),
      modes: shape === 'atom' ? [] : list(values, 'modes'),
      g0: num(values, 'g0'),
    });
  },
};
