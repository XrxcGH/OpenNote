// What the linear algebra workbench starts with, and how it turns its fields into an answer for the chosen operation.
import { whole, type NumOut } from '../numerics/common';
import { eigenSteps } from './eigenexact';
import {
  coordinates,
  leastSquares,
  luSteps,
  mapMatrix,
  polynomialLeastSquares,
  projection,
  qrSteps,
  svdSteps,
  transition,
} from './factor';
import { determinantSteps, inverseOf, reduceOnly, solveSystem, subspaces } from './solve';

export const OPERATIONS = [
  'solve',
  'rref',
  'inverse',
  'det',
  'spaces',
  'lu',
  'qr',
  'eigen',
  'svd',
  'projection',
  'lsq',
  'polyfit',
  'coords',
  'transition',
  'map',
] as const;
export type Operation = (typeof OPERATIONS)[number];

export const FIRST = {
  op: 'solve' as Operation,
  A: '1 2 -1\n2 3 -1\n-2 0 -3',
  B: '1 1\n0 1',
  C: '1 0\n1 1',
  b: '-4 -11 22',
  points: '0, 1\n1, 3\n2, 4\n3, 4',
  degree: '1',
};
export type State = typeof FIRST;

/** Sample inputs for each operation, loaded when it is chosen so there is always something to read. */
export const SAMPLES: Partial<Record<Operation, Partial<State>>> = {
  solve: { A: '1 2 -1\n2 3 -1\n-2 0 -3', b: '-4 -11 22' },
  rref: { A: '1 2 3\n2 4 6\n1 1 1' },
  inverse: { A: '2 1\n5 3' },
  det: { A: '6 1 1\n4 -2 5\n2 8 7' },
  spaces: { A: '1 2 3\n2 4 6' },
  lu: { A: '2 1 1\n4 3 3\n8 7 9' },
  qr: { A: '1 1\n1 0\n0 1' },
  eigen: { A: '4 1\n2 3' },
  svd: { A: '3 2 2\n2 3 -2' },
  projection: { A: '1 0\n1 1\n1 2', b: '6 0 0' },
  lsq: { A: '1 0\n1 1\n1 2\n1 3', b: '1 3 4 4' },
  coords: { A: '1 1\n0 1', b: '3 2' },
  transition: { A: '1 1\n0 1', C: '1 0\n1 1' },
  map: { A: '2 0\n0 3', B: '1 1\n0 1', C: '1 0\n1 1' },
};

export function run(s: State): NumOut {
  switch (s.op) {
    case 'solve':
      return solveSystem(s.A, s.b);
    case 'rref':
      return reduceOnly(s.A);
    case 'inverse':
      return inverseOf(s.A);
    case 'det':
      return determinantSteps(s.A);
    case 'spaces':
      return subspaces(s.A);
    case 'lu':
      return luSteps(s.A);
    case 'qr':
      return qrSteps(s.A);
    case 'eigen':
      return eigenSteps(s.A);
    case 'svd':
      return svdSteps(s.A);
    case 'projection':
      return projection(s.A, s.b);
    case 'lsq':
      return leastSquares(s.A, s.b);
    case 'polyfit':
      return polynomialLeastSquares(s.points, whole(s.degree, 'degree', 0, 6));
    case 'coords':
      return coordinates(s.A, s.b);
    case 'transition':
      return transition(s.A, s.C);
    default:
      return mapMatrix(s.A, s.B, s.C);
  }
}
