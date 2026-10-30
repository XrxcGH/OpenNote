// What the vector calculus tool starts with, and how it turns its fields into an answer for the chosen operation.
import type { NumOut } from '../numerics/common';
import { greenTheorem, lineIntegral, potentialDifference, type GreenRegion } from './curves';
import { divergenceCurl, gradient, jacobian, type CoordinateSystem } from './diff';
import { criticalPoints, lagrange } from './optimize';
import { divergenceTheorem, stokesTheorem, surfaceIntegral } from './surfaces';

export const OPERATIONS = [
  'gradient',
  'critical',
  'lagrange',
  'divcurl',
  'jacobian',
  'line',
  'linescalar',
  'potential',
  'green',
  'surface',
  'divergence',
  'stokes',
] as const;
export type Operation = (typeof OPERATIONS)[number];

export const FIRST = {
  op: 'gradient' as Operation,
  f: 'x^2*y + sin(y*z)',
  field: 'x^2, y^2, z^2',
  point: '1, 1, 1',
  direction: '1, 2, 2',
  window: '-4, 4, -4, 4',
  g: 'x + y',
  c: '10',
  system: 'cartesian' as CoordinateSystem,
  map: 'r*cos(theta), r*sin(theta)',
  vars: 'r, theta',
  curve: 'cos(t), sin(t)',
  range: '0, 2*pi',
  start: '0, 0',
  end: '1, 2',
  region: 'rect' as GreenRegion,
  rect: '0, 1, 0, 2',
  disk: '0, 0, 1',
  lower: 'x^2',
  upper: 'x',
  xRange: '0, 1',
  surface: 'sin(u)*cos(v), sin(u)*sin(v), cos(u)',
  uv: '0, pi, 0, 2*pi',
  surfaceKind: 'flux' as 'flux' | 'scalar' | 'area',
  solid: 'sphere' as 'sphere' | 'box',
  radius: '1',
  box: '0, 1, 0, 1, 0, 1',
};
export type State = typeof FIRST;

/** Sample inputs for each operation, loaded when it is chosen so there is always something to read. */
export const SAMPLES: Partial<Record<Operation, Partial<State>>> = {
  gradient: { f: 'x^2*y + sin(y*z)', point: '1, 1, 1', direction: '1, 2, 2' },
  critical: { f: 'x^3 - 3*x + y^2', window: '-4, 4, -4, 4' },
  lagrange: { f: 'x*y', g: 'x + y', c: '10', window: '-10, 10, -10, 10' },
  divcurl: { field: 'x^2, y^2, z^2', point: '1, 1, 1', system: 'cartesian' },
  jacobian: { map: 'r*cos(theta), r*sin(theta)', vars: 'r, theta', point: '2, 0.5' },
  line: { field: 'y, x', curve: 't, 2*t', range: '0, 1' },
  linescalar: { f: 'x*y', curve: 'cos(t), sin(t)', range: '0, pi/2' },
  potential: { field: 'y, x', start: '0, 0', end: '1, 2' },
  green: { field: '-y, x', region: 'disk', disk: '0, 0, 1' },
  surface: {
    field: 'x, y, z',
    surface: 'sin(u)*cos(v), sin(u)*sin(v), cos(u)',
    uv: '0, pi, 0, 2*pi',
    surfaceKind: 'flux',
  },
  divergence: { field: 'x, y, z', solid: 'sphere', radius: '1' },
  stokes: { field: '-y, x, 0', surface: 'sin(u)*cos(v), sin(u)*sin(v), cos(u)', uv: '0, pi/2, 0, 2*pi' },
};

export function run(s: State): NumOut {
  switch (s.op) {
    case 'gradient':
      return gradient(s.f, s.point, s.direction);
    case 'critical':
      return criticalPoints(s.f, s.window);
    case 'lagrange':
      return lagrange(s.f, s.g, s.c, s.window);
    case 'divcurl':
      return divergenceCurl(s.field, s.system, s.point);
    case 'jacobian':
      return jacobian(s.map, s.vars, s.point);
    case 'line':
      return lineIntegral('vector', s.field, s.curve, s.range);
    case 'linescalar':
      return lineIntegral('scalar', s.f, s.curve, s.range);
    case 'potential':
      return potentialDifference(s.field, s.start, s.end);
    case 'green':
      return greenTheorem(s.field, s.region, {
        rect: s.rect,
        disk: s.disk,
        lower: s.lower,
        upper: s.upper,
        xRange: s.xRange,
      });
    case 'surface':
      return surfaceIntegral(s.surfaceKind, s.surfaceKind === 'scalar' ? s.f : s.field, s.surface, s.uv);
    case 'divergence':
      return divergenceTheorem(s.field, s.solid, s.radius, s.box);
    default:
      return stokesTheorem(s.field, s.surface, s.uv);
  }
}
