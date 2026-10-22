// The double and triple integral helper. A person gives a region (a preset such as a disk or a ball, or limits of
// their own) and an integrand, picks rectangular, polar, cylindrical, or spherical coordinates, and gets the limits,
// the change of variables with its Jacobian, each inner integral worked by hand where the rules allow, and the value.
// Every answer is also found numerically, so a step the rules cannot do still ends in a number, and a symbolic answer
// is checked against it.
import { antiderivative, collect, definite, quadrature } from './integrate';
import {
  SolverError,
  build,
  compile,
  namesIn,
  niceNumber,
  numberText,
  prettyText,
  read,
  show,
  substitute,
  tidy,
  type Node,
} from './expr';
import { step, type Step, type XY } from './steps';

export type CoordinateSystem = 'rectangular' | 'polar' | 'cylindrical' | 'spherical';

/** One integral sign: the variable and its bounds, as text. */
export interface Limit {
  readonly variable: string;
  readonly lower: string;
  readonly upper: string;
}

export interface IntegralInput {
  readonly integrand: string;
  readonly system: CoordinateSystem;
  /** Innermost integral first. */
  readonly limits: readonly Limit[];
}

export interface IntegralResult {
  readonly steps: readonly Step[];
  /** The value found numerically, always. */
  readonly value: number;
  /** The value as a textbook writes it, such as 4π/3. */
  readonly valueText: string;
  /** True when every inner integral was found by the rules, not only numerically. */
  readonly symbolic: boolean;
  /** The integral as written, such as ∫[0, 1] ∫[0, x] x·y dy dx. */
  readonly setup: string;
  /** The region in the plane, or its shadow on the xy-plane, as a closed outline. Null when it cannot be drawn. */
  readonly outline: readonly XY[] | null;
}

const { mul } = build;

/** What each system turns x, y, and z into, and its area or volume element. */
const SYSTEMS: Record<Exclude<CoordinateSystem, 'rectangular'>, { map: Record<string, string>; jacobian: string }> = {
  polar: { map: { x: 'r*cos(theta)', y: 'r*sin(theta)' }, jacobian: 'r' },
  cylindrical: { map: { x: 'r*cos(theta)', y: 'r*sin(theta)' }, jacobian: 'r' },
  spherical: {
    map: { x: 'rho*sin(phi)*cos(theta)', y: 'rho*sin(phi)*sin(theta)', z: 'rho*cos(phi)' },
    jacobian: 'rho^2*sin(phi)',
  },
};

/** The variables each system integrates over. */
export const SYSTEM_VARIABLES: Record<CoordinateSystem, readonly string[]> = {
  rectangular: ['x', 'y', 'z'],
  polar: ['r', 'theta'],
  cylindrical: ['z', 'r', 'theta'],
  spherical: ['rho', 'phi', 'theta'],
};

const GREEK: Record<string, string> = { theta: 'θ', phi: 'φ', rho: 'ρ' };
const letter = (v: string): string => GREEK[v] ?? v;

/** The integral written out, outermost sign first. */
export function setupText(integrand: string, limits: readonly Limit[]): string {
  const signs = [...limits]
    .reverse()
    .map((one) => `∫[${one.lower}, ${one.upper}]`)
    .join(' ');
  const ds = limits.map((one) => `d${letter(one.variable)}`).join(' ');
  return `${signs} ${integrand} ${ds}`;
}

/** Checks the limits: two or three distinct variables, and each bound uses only variables of outer integrals. */
function checkLimits(limits: readonly Limit[], bounds: readonly (readonly [Node, Node])[]): void {
  if (limits.length < 1 || limits.length > 3) throw new SolverError('limits-count');
  const variables = limits.map((one) => one.variable.trim());
  if (new Set(variables).size !== variables.length || variables.some((v) => !/^[A-Za-z]+$/.test(v)))
    throw new SolverError('limits-variables');
  bounds.forEach(([lo, hi], i) => {
    for (const used of [...namesIn(lo), ...namesIn(hi)]) {
      const at = variables.indexOf(used);
      if (at < 0) throw new SolverError('unknown-name', used);
      if (at <= i) throw new SolverError('limits-order', limits[i].variable);
    }
  });
}

/** The integrand in the system's variables, times the Jacobian. */
function inSystem(integrand: Node, system: CoordinateSystem): { node: Node; jacobian: string | null } {
  if (system === 'rectangular') return { node: integrand, jacobian: null };
  const { map, jacobian } = SYSTEMS[system];
  let node = integrand;
  for (const [from, to] of Object.entries(map)) node = substitute(node, from, read(to));
  return { node: tidy(mul(node, read(jacobian))), jacobian };
}

/** The change of variables, as a line of math. */
function changeText(system: Exclude<CoordinateSystem, 'rectangular'>): string {
  const { map, jacobian } = SYSTEMS[system];
  const parts = Object.entries(map).map(([from, to]) => `${from} = ${show(read(to))}`);
  const element = system === 'polar' ? 'dA' : 'dV';
  const ds = SYSTEM_VARIABLES[system].map((v) => `d${letter(v)}`).join(' ');
  return prettyText(`${parts.join(', ')}, ${element} = ${show(read(jacobian))} ${ds}`);
}

const greekText = prettyText;

/** Works the integral. Throws a SolverError when the input cannot be read or the limits are out of order. */
export function solveIntegral(input: IntegralInput): IntegralResult {
  const limits = input.limits.map((one) => ({ ...one, variable: one.variable.trim() }));
  const bounds = limits.map((one) => [read(one.lower), read(one.upper)] as const);
  checkLimits(limits, bounds);
  const variables = limits.map((one) => one.variable);
  const raw = read(input.integrand);
  const { node: integrand, jacobian } = inSystem(raw, input.system);
  for (const used of namesIn(integrand)) if (!variables.includes(used)) throw new SolverError('unknown-name', used);

  const setup = prettyText(setupText(input.integrand, limits));
  const steps: Step[] = [step('integralSetup', greekText(setup))];
  if (input.system !== 'rectangular' && jacobian) {
    steps.push(step('integralChange', changeText(input.system), { system: input.system }));
    steps.push(step('integralIntegrand', greekText(show(integrand))));
  }

  // By hand, from the inside out.
  let current: Node | null = integrand;
  for (let i = 0; i < limits.length && current; i += 1) {
    const v = variables[i];
    const F = antiderivative(current, v);
    if (!F) {
      steps.push(step('integralNoRule', greekText(show(current)), { variable: letter(v) }));
      current = null;
      break;
    }
    const outer = variables[i + 1];
    const result = collect(definite(F, v, bounds[i][0], bounds[i][1]), outer ?? v);
    steps.push(
      step('integralInner', `∫ ${greekText(show(current))} d${letter(v)} = ${greekText(show(F))}`, {
        variable: letter(v),
      }),
    );
    steps.push(
      step(
        'integralBounds',
        `[${greekText(show(F))}] from ${letter(v)} = ${greekText(show(bounds[i][0]))} to ${greekText(show(bounds[i][1]))} = ${greekText(show(result))}`,
      ),
    );
    current = result;
  }

  const value = numericValue(integrand, variables, bounds);
  let symbolic = false;
  if (current) {
    const exact = compile(current, [])([]);
    // The rules' answer must agree with the numeric one, or the numeric one stands.
    symbolic = Number.isFinite(exact) && Math.abs(exact - value) <= 1e-7 * Math.max(1, Math.abs(value));
  }
  const valueText = niceNumber(value);
  steps.push(
    step(
      symbolic ? 'integralValue' : 'integralNumeric',
      `= ${valueText}${valueText === numberText(value) ? '' : ` ≈ ${numberText(value)}`}`,
    ),
  );
  return { steps, value, valueText, symbolic, setup, outline: outline(input.system, limits, bounds) };
}

/** The value by nested numeric integration. */
export function numericValue(
  integrand: Node,
  variables: readonly string[],
  bounds: readonly (readonly [Node, Node])[],
): number {
  const f = compile(integrand, variables);
  const lo = bounds.map(([one]) => compile(one, variables));
  const hi = bounds.map(([, one]) => compile(one, variables));
  const values = variables.map(() => 0);
  const coarse = variables.length > 1;
  const level = (i: number): number =>
    quadrature(
      (t) => {
        values[i] = t;
        return i === 0 ? f(values) : level(i - 1);
      },
      lo[i](values),
      hi[i](values),
      coarse,
    );
  return level(variables.length - 1);
}

/** The outline of the region of the two outer integrals, in the xy-plane. */
function outline(
  system: CoordinateSystem,
  limits: readonly Limit[],
  bounds: readonly (readonly [Node, Node])[],
): XY[] | null {
  if (limits.length < 2 || system === 'spherical') return null;
  const n = limits.length;
  const [outerVar, middleVar] = [limits[n - 1].variable, limits[n - 2].variable];
  const variables = limits.map((one) => one.variable);
  const [a, b] = bounds[n - 1].map((one) => compile(one, [])([]));
  const lo = compile(bounds[n - 2][0], variables);
  const hi = compile(bounds[n - 2][1], variables);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const at = (s: number, g: number): XY => {
    if (system === 'rectangular') return outerVar === 'x' || middleVar === 'y' ? { x: s, y: g } : { x: g, y: s };
    const [r, theta] = outerVar === 'theta' ? [g, s] : [s, g];
    return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
  };
  const values = variables.map(() => 0);
  const lower: XY[] = [];
  const upper: XY[] = [];
  const count = 96;
  for (let i = 0; i <= count; i += 1) {
    const s = a + ((b - a) * i) / count;
    values[n - 1] = s;
    const [g1, g2] = [lo(values), hi(values)];
    if (!Number.isFinite(g1) || !Number.isFinite(g2)) return null;
    lower.push(at(s, g1));
    upper.push(at(s, g2));
  }
  return [...lower, ...upper.reverse()];
}

/** A region with a ready set of limits in each system that suits it. */
export type RegionKind = 'rectangle' | 'between' | 'disk' | 'box' | 'cylinder' | 'ball' | 'cone';

export const REGION_PARAMS: Record<RegionKind, readonly string[]> = {
  rectangle: ['a', 'b', 'c', 'd'],
  between: ['a', 'b', 'g1', 'g2'],
  disk: ['R'],
  box: ['a', 'b', 'c', 'd', 'e', 'f'],
  cylinder: ['R', 'h'],
  ball: ['R'],
  cone: ['R', 'h'],
};

/** The systems that suit each region, best first. */
export const REGION_SYSTEMS: Record<RegionKind, readonly CoordinateSystem[]> = {
  rectangle: ['rectangular'],
  between: ['rectangular'],
  disk: ['polar', 'rectangular'],
  box: ['rectangular'],
  cylinder: ['cylindrical', 'rectangular'],
  ball: ['spherical', 'cylindrical', 'rectangular'],
  cone: ['cylindrical', 'spherical'],
};

const lim = (variable: string, lower: string, upper: string): Limit => ({ variable, lower, upper });

/** The limits for a region in a system, innermost first, or null when the pair does not go together. */
export function regionLimits(
  kind: RegionKind,
  system: CoordinateSystem,
  p: Readonly<Record<string, string>>,
): Limit[] | null {
  if (!REGION_SYSTEMS[kind].includes(system)) return null;
  const g = (key: string) => `(${p[key] ?? '1'})`;
  const R = g('R');
  const h = g('h');
  switch (`${kind}/${system}`) {
    case 'rectangle/rectangular':
      return [lim('y', p.c, p.d), lim('x', p.a, p.b)];
    case 'between/rectangular':
      return [lim('y', p.g1, p.g2), lim('x', p.a, p.b)];
    case 'disk/polar':
      return [lim('r', '0', p.R), lim('theta', '0', '2*pi')];
    case 'disk/rectangular':
      return [lim('y', `-sqrt(${R}^2 - x^2)`, `sqrt(${R}^2 - x^2)`), lim('x', `-${R}`, p.R)];
    case 'box/rectangular':
      return [lim('z', p.e, p.f), lim('y', p.c, p.d), lim('x', p.a, p.b)];
    case 'cylinder/cylindrical':
      return [lim('z', '0', p.h), lim('r', '0', p.R), lim('theta', '0', '2*pi')];
    case 'cylinder/rectangular':
      return [lim('z', '0', p.h), lim('y', `-sqrt(${R}^2 - x^2)`, `sqrt(${R}^2 - x^2)`), lim('x', `-${R}`, p.R)];
    case 'ball/spherical':
      return [lim('rho', '0', p.R), lim('phi', '0', 'pi'), lim('theta', '0', '2*pi')];
    case 'ball/cylindrical':
      return [lim('z', `-sqrt(${R}^2 - r^2)`, `sqrt(${R}^2 - r^2)`), lim('r', '0', p.R), lim('theta', '0', '2*pi')];
    case 'ball/rectangular':
      return [
        lim('z', `-sqrt(${R}^2 - x^2 - y^2)`, `sqrt(${R}^2 - x^2 - y^2)`),
        lim('y', `-sqrt(${R}^2 - x^2)`, `sqrt(${R}^2 - x^2)`),
        lim('x', `-${R}`, p.R),
      ];
    case 'cone/cylindrical':
      return [lim('z', `${h}*r/${R}`, p.h), lim('r', '0', p.R), lim('theta', '0', '2*pi')];
    case 'cone/spherical':
      return [lim('rho', '0', `${h}/cos(phi)`), lim('phi', '0', `atan(${R}/${h})`), lim('theta', '0', '2*pi')];
    default:
      return null;
  }
}
