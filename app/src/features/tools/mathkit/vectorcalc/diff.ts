// Differential operators: the gradient with its directional derivative and tangent plane, divergence and curl in
// Cartesian, cylindrical, and spherical coordinates, and the Jacobian of a change of variables. Results are written
// symbolically, then evaluated at a point.
import { fmt } from '../numeric';
import { line, numbers, type NumLine, type NumOut } from '../numerics/common';
import { KitError, step, type KitStep } from '../types';
import {
  checkNames,
  compiled,
  compiledMany,
  components,
  dotV,
  isZeroText,
  normV,
  partial,
  sumText,
  tex,
  usedVariables,
} from './field';

const ok = (lines: NumLine[], steps: KitStep[], latex?: string): NumOut => ({
  lines,
  tables: [],
  plots: [],
  fields: [],
  steps,
  ...(latex ? { latex } : {}),
});

const tuple = (v: readonly number[]) => `(${v.map((x) => fmt(x, 8)).join(', ')})`;
const textTuple = (v: readonly string[]) => `(${v.join(', ')})`;
const texRow = (v: readonly string[]) => `\\left(${v.map(tex).join(',\\ ')}\\right)`;

export function gradient(fText: string, pointText: string, directionText: string): NumOut {
  const vars = usedVariables([fText], ['x', 'y', 'z']);
  if (vars.length === 0) throw new KitError('vcNoVariables');
  checkNames(fText, ['x', 'y', 'z']);
  const parts = vars.map((v) => partial(fText, v));
  const p = numbers(pointText, 'point');
  if (p.length !== vars.length) throw new KitError('vcPointLength', `${vars.join(', ')}`);
  const f = compiled(fText, vars);
  const g = compiledMany(parts, vars)(p);
  const f0 = f(p);
  if (!Number.isFinite(f0) || g.some((x) => !Number.isFinite(x))) throw new KitError('undefinedValue', `f${tuple(p)}`);
  const lines: NumLine[] = [
    line('vcGradient', { grad: textTuple(parts) }),
    line('vcGradientAt', { point: tuple(p), f: fmt(f0, 8), grad: tuple(g), norm: fmt(normV(g), 8) }),
  ];
  const steps: KitStep[] = [
    step('vcPartials', parts.map((t, i) => `\\frac{\\partial f}{\\partial ${vars[i]}}=${tex(t)}`).join(',\\ ')),
    step('vcGradientStep', `\\nabla f=${texRow(parts)}`),
    step('vcAtPoint', `\\nabla f${tuple(p)}=${tuple(g)}`),
  ];
  if (directionText.trim()) {
    const u = numbers(directionText, 'direction');
    if (u.length !== vars.length) throw new KitError('vcPointLength', `${vars.join(', ')}`);
    const length = normV(u);
    if (length === 0) throw new KitError('vcZeroDirection');
    const unit = u.map((x) => x / length);
    lines.push(line('vcDirectional', { dir: tuple(unit), value: fmt(dotV(g, unit), 8) }));
    steps.push(step('vcDirectionalStep', `D_{\\mathbf{u}}f=\\nabla f\\cdot\\mathbf{u}=${fmt(dotV(g, unit), 8)}`));
  }
  const rate = normV(g);
  if (rate > 0) lines.push(line('vcSteepest', { dir: tuple(g.map((x) => x / rate)), rate: fmt(rate, 8) }));
  const plane = tangentPlane(vars, p, f0, g);
  lines.push(line('vcPlane', { plane: plane.text }));
  steps.push(step('vcPlaneStep', plane.latex));
  return ok(lines, steps, `\\nabla f=${texRow(parts)}`);
}

function tangentPlane(vars: string[], p: number[], f0: number, g: number[]): { text: string; latex: string } {
  const terms = vars.map((v, i) => `${fmt(g[i], 6)}*(${v} - ${fmt(p[i], 6)})`);
  if (vars.length === 2) {
    const text = `z = ${fmt(f0, 6)} + ${terms.join(' + ')}`;
    return { text, latex: text.replace(/\*/g, '\\cdot ') };
  }
  const text = `${terms.join(' + ')} = 0`;
  return { text, latex: text.replace(/\*/g, '\\cdot ') };
}

// ---------------------------------------------------------------------------------------------------------------
// Divergence and curl
// ---------------------------------------------------------------------------------------------------------------

export type CoordinateSystem = 'cartesian' | 'cylindrical' | 'spherical';

const SYSTEMS: Record<CoordinateSystem, { vars: string[]; names: string[] }> = {
  cartesian: { vars: ['x', 'y', 'z'], names: ['x', 'y', 'z'] },
  cylindrical: { vars: ['r', 'theta', 'z'], names: ['r', 'theta', 'z'] },
  spherical: { vars: ['r', 'theta', 'phi'], names: ['r', 'theta', 'phi'] },
};

const d = partial;

interface DivCurl {
  div: string;
  curl: string[];
}

function cartesianOps([P, Q, R]: string[]): DivCurl {
  return {
    div: sumText([d(P, 'x'), d(Q, 'y'), d(R, 'z')]),
    curl: [
      sumText([d(R, 'y'), `-(${d(Q, 'z')})`]),
      sumText([d(P, 'z'), `-(${d(R, 'x')})`]),
      sumText([d(Q, 'x'), `-(${d(P, 'y')})`]),
    ],
  };
}

function cylindricalOps([Fr, Ft, Fz]: string[]): DivCurl {
  return {
    div: sumText([`(${d(`r*(${Fr})`, 'r')})/r`, `(${d(Ft, 'theta')})/r`, d(Fz, 'z')]),
    curl: [
      sumText([`(${d(Fz, 'theta')})/r`, `-(${d(Ft, 'z')})`]),
      sumText([d(Fr, 'z'), `-(${d(Fz, 'r')})`]),
      sumText([`(${d(`r*(${Ft})`, 'r')})/r`, `-(${d(Fr, 'theta')})/r`]),
    ],
  };
}

function sphericalOps([Fr, Ft, Fp]: string[]): DivCurl {
  return {
    div: sumText([
      `(${d(`r^2*(${Fr})`, 'r')})/r^2`,
      `(${d(`sin(theta)*(${Ft})`, 'theta')})/(r*sin(theta))`,
      `(${d(Fp, 'phi')})/(r*sin(theta))`,
    ]),
    curl: [
      sumText([`(${d(`sin(theta)*(${Fp})`, 'theta')})/(r*sin(theta))`, `-(${d(Ft, 'phi')})/(r*sin(theta))`]),
      sumText([`(${d(Fr, 'phi')})/(r*sin(theta))`, `-(${d(`r*(${Fp})`, 'r')})/r`]),
      sumText([`(${d(`r*(${Ft})`, 'r')})/r`, `-(${d(Fr, 'theta')})/r`]),
    ],
  };
}

export function divergenceCurl(fieldText: string, system: CoordinateSystem, pointText: string): NumOut {
  const sys = SYSTEMS[system];
  const comps = components(fieldText, system === 'cartesian' ? [2, 3] : [3]);
  const planar = comps.length === 2;
  const full = planar ? [...comps, '0'] : comps;
  full.forEach((c) => checkNames(c, sys.names));
  const ops =
    system === 'cartesian' ? cartesianOps(full) : system === 'cylindrical' ? cylindricalOps(full) : sphericalOps(full);
  const curl = planar ? [ops.curl[2]] : ops.curl;
  const steps: KitStep[] = [
    step('vcFieldStep', `\\mathbf{F}=${texRow(comps)}`),
    step('vcDivStep', `\\nabla\\cdot\\mathbf{F}=${tex(ops.div)}`, { $system: `kitMath.vectorcalc.system.${system}` }),
    step(
      'vcCurlStep',
      planar ? `(\\nabla\\times\\mathbf{F})_z=${tex(curl[0])}` : `\\nabla\\times\\mathbf{F}=${texRow(curl)}`,
      {
        $system: `kitMath.vectorcalc.system.${system}`,
      },
    ),
  ];
  const lines: NumLine[] = [
    line('vcDiv', { div: ops.div }),
    line(planar ? 'vcCurl2' : 'vcCurl', { curl: planar ? curl[0] : textTuple(curl) }),
    line(isZeroText(ops.div) ? 'vcSolenoidal' : 'vcNotSolenoidal'),
    line(curl.every(isZeroText) ? 'vcIrrotational' : 'vcNotIrrotational'),
  ];
  if (pointText.trim()) {
    const p = numbers(pointText, 'point');
    if (p.length !== 3) throw new KitError('vcPointLength', sys.vars.join(', '));
    const div = compiled(ops.div, sys.vars)(p);
    const cv = compiledMany(curl, sys.vars)(p);
    lines.push(
      line('vcDivAt', { point: tuple(p), div: fmt(div, 8) }),
      line('vcCurlAt', { curl: planar ? fmt(cv[0], 8) : tuple(cv) }),
    );
    steps.push(step('vcAtPoint', `\\nabla\\cdot\\mathbf{F}${tuple(p)}=${fmt(div, 8)}`));
  }
  return ok(
    lines,
    steps,
    `\\nabla\\cdot\\mathbf{F}=${tex(ops.div)},\\ \\nabla\\times\\mathbf{F}=${planar ? tex(curl[0]) : texRow(curl)}`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Jacobian
// ---------------------------------------------------------------------------------------------------------------

export function jacobian(mapText: string, varsText: string, pointText: string): NumOut {
  const vars = varsText.split(/[\s,;]+/).filter(Boolean);
  if (vars.length < 2 || vars.length > 3) throw new KitError('vcJacobianSize');
  const comps = components(mapText, [vars.length], 'map');
  comps.forEach((c) => checkNames(c, vars));
  const J = comps.map((c) => vars.map((v) => partial(c, v)));
  const det = vars.length === 2 ? sumText([`(${J[0][0]})*(${J[1][1]})`, `-(${J[0][1]})*(${J[1][0]})`]) : det3(J);
  const steps: KitStep[] = [
    step('vcJacobianMatrix', `J=${matrixTex(J)}`),
    step(
      'vcJacobianDet',
      `\\left|\\frac{\\partial(${comps.length === 2 ? 'x,y' : 'x,y,z'})}{\\partial(${vars.join(',')})}\\right|=${tex(det)}`,
    ),
  ];
  const lines: NumLine[] = [line('vcJacobian', { det })];
  if (pointText.trim()) {
    const p = numbers(pointText, 'point');
    if (p.length !== vars.length) throw new KitError('vcPointLength', vars.join(', '));
    const value = compiled(det, vars)(p);
    lines.push(line('vcJacobianAt', { point: tuple(p), det: fmt(value, 8) }));
    steps.push(step('vcAtPoint', `\\det J${tuple(p)}=${fmt(value, 8)}`));
  }
  return ok(lines, steps, `\\det J=${tex(det)}`);
}

const matrixTex = (J: string[][]) =>
  `\\begin{pmatrix} ${J.map((r) => r.map(tex).join(' & ')).join(' \\\\ ')} \\end{pmatrix}`;

function det3(J: string[][]): string {
  const m0 = `((${J[1][1]})*(${J[2][2]})-(${J[1][2]})*(${J[2][1]}))`;
  const m1 = `((${J[1][0]})*(${J[2][2]})-(${J[1][2]})*(${J[2][0]}))`;
  const m2 = `((${J[1][0]})*(${J[2][1]})-(${J[1][1]})*(${J[2][0]}))`;
  return sumText([`(${J[0][0]})*${m0}`, `-(${J[0][1]})*${m1}`, `(${J[0][2]})*${m2}`]);
}
