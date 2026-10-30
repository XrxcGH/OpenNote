// What the numerical methods tool starts with, and how it turns its fields into an answer for the chosen method.
import { differentiate, quadrature, type QuadMethod } from './calculus';
import { num, whole, type NumOut } from './common';
import { nonlinearFit, polynomialFit, spectrum } from './fit';
import { interpolate, type InterpMethod } from './interp';
import { iterativeSolve, newtonSolve, type IterMethod } from './linsolve';
import { solveBvp, solveIvp, type IvpMethod } from './ode';
import { solveHeat2d, solvePoisson } from './pde';

export const TOPICS = [
  'interp',
  'diff',
  'quad',
  'ivp',
  'bvp',
  'iter',
  'newton',
  'poisson',
  'heat',
  'polyfit',
  'nlfit',
  'fft',
] as const;
export type Topic = (typeof TOPICS)[number];

export const FIRST = {
  topic: 'interp' as Topic,
  points: '0, 0\n1, 1\n2, 0',
  interpMethod: 'natural' as InterpMethod,
  at: '0.5',
  slope0: '0',
  slopeN: '0',
  fx: 'exp(x)',
  a: '0',
  b: '1',
  n: '4',
  quad: 'simpson' as QuadMethod,
  x0: '1',
  h: '0.1',
  derivOrder: '1',
  f: 'y',
  exact: 'exp(t)',
  t0: '0',
  y0: '1',
  tEnd: '1',
  step: '0.1',
  ivp: 'euler' as IvpMethod,
  bp: '0',
  bq: '1',
  br: '0',
  ba: '0',
  bb: 'pi/2',
  alpha: '0',
  beta: '1',
  bn: '20',
  bvp: 'difference',
  bexact: 'sin(x)',
  A: '4 -1 0\n-1 4 -1\n0 -1 4',
  rhs: '15, 10, 10',
  guess: '0, 0, 0',
  iter: 'gauss-seidel' as IterMethod,
  omega: '1.1',
  tol: '1e-8',
  maxIt: '100',
  eqs: 'x^2+y^2=4\nx*y=1',
  unknowns: 'x, y',
  start: '2, 0.5',
  gn: '11',
  gw: '1',
  gh: '1',
  top: '100',
  bottom: '0',
  left: '0',
  right: '0',
  source: '0',
  alpha2: '1',
  init2: 'sin(pi*x)*sin(pi*y)',
  dt: '0.001',
  tEnd2: '0.05',
  data: '0, 1\n1, 3\n2, 4\n3, 4',
  degree: '1',
  model: 'a*exp(b*x)',
  names: 'a, b',
  fitStart: '1, 0.1',
  samples: '0, 1, 0, -1, 0, 1, 0, -1',
  rate: '8',
};
export type State = typeof FIRST;

export function run(s: State): NumOut {
  switch (s.topic) {
    case 'interp':
      return interpolate(s.points, s.interpMethod, num(s.at, 'x'), num(s.slope0, 'slope'), num(s.slopeN, 'slope'));
    case 'diff':
      return differentiate(s.fx, num(s.x0, 'x'), num(s.h, 'h'), s.derivOrder === '2' ? 2 : 1);
    case 'quad': {
      const count = s.quad === 'gauss' || s.quad === 'romberg' ? whole(s.n, 'n', 1, 12) : whole(s.n, 'n', 1, 100000);
      return quadrature(s.fx, num(s.a, 'a'), num(s.b, 'b'), count, s.quad);
    }
    case 'ivp':
      return solveIvp({
        f: s.f,
        exact: s.exact,
        t0: num(s.t0, 't0'),
        y0: num(s.y0, 'y0'),
        tEnd: num(s.tEnd, 'tEnd'),
        h: s.ivp === 'rk45' ? 0.1 : num(s.step, 'h'),
        method: s.ivp,
      });
    case 'bvp':
      return solveBvp({
        p: s.bp,
        q: s.bq,
        r: s.br,
        a: num(s.ba, 'a'),
        b: num(s.bb, 'b'),
        alpha: num(s.alpha, 'alpha'),
        beta: num(s.beta, 'beta'),
        n: whole(s.bn, 'n', 2, 2000),
        method: s.bvp === 'shooting' ? 'shooting' : 'difference',
        exact: s.bexact,
      });
    case 'iter':
      return iterativeSolve({
        A: s.A,
        b: s.rhs,
        x0: s.guess,
        method: s.iter,
        omega: num(s.omega, 'omega'),
        tolerance: num(s.tol, 'tolerance'),
        maxIterations: whole(s.maxIt, 'maximum iterations', 1, 100000),
      });
    case 'newton':
      return newtonSolve({ equations: s.eqs, unknowns: s.unknowns, start: s.start, tolerance: 1e-12 });
    case 'poisson': {
      const k = whole(s.gn, 'grid points', 3, 80);
      return solvePoisson({
        nx: k,
        ny: k,
        width: num(s.gw, 'width'),
        height: num(s.gh, 'height'),
        edges: { top: s.top, bottom: s.bottom, left: s.left, right: s.right },
        source: s.source,
        tolerance: 1e-11,
      });
    }
    case 'heat': {
      const k = whole(s.gn, 'grid points', 3, 60);
      return solveHeat2d({
        nx: k,
        ny: k,
        width: num(s.gw, 'width'),
        height: num(s.gh, 'height'),
        alpha: num(s.alpha2, 'alpha'),
        edges: { top: s.top, bottom: s.bottom, left: s.left, right: s.right },
        initial: s.init2,
        dt: num(s.dt, 'dt'),
        tEnd: num(s.tEnd2, 'time'),
      });
    }
    case 'polyfit':
      return polynomialFit(s.data, whole(s.degree, 'degree', 0, 10));
    case 'nlfit':
      return nonlinearFit({ source: s.data, model: s.model, names: s.names, start: s.fitStart });
    default:
      return spectrum(s.samples, num(s.rate, 'sampling rate'));
  }
}
