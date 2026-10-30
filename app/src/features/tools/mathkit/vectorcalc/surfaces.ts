// Integrals over surfaces: flux, surface area, and scalar surface integrals over a parametrized surface, and the
// divergence theorem and Stokes' theorem, each worked out on both sides so the two numbers can be compared.
import { fmt } from '../numeric';
import { line, numbers, type NumOut } from '../numerics/common';
import { KitError, step, type KitStep } from '../types';
import { checkNames, compiled, compiledMany, components, crossV, dotV, normV, partial, sumText, tex } from './field';
import { glBox, int1, int2 } from './quad';

function ranges(text: string, count: 4 | 6, name: string): number[] {
  const r = numbers(text, name);
  if (r.length !== count || r.some((v, i) => i % 2 === 0 && !(v < r[i + 1]))) throw new KitError('vcRanges', name);
  return r;
}

interface Surface {
  texts: string[];
  r: (u: number, v: number) => number[];
  ru: (u: number, v: number) => number[];
  rv: (u: number, v: number) => number[];
  n: (u: number, v: number) => number[];
  ruTexts: string[];
  rvTexts: string[];
}

function readSurface(text: string): Surface {
  const texts = components(text, [3], 'r(u, v)');
  texts.forEach((c) => checkNames(c, ['u', 'v']));
  const ruTexts = texts.map((c) => partial(c, 'u'));
  const rvTexts = texts.map((c) => partial(c, 'v'));
  const R = compiledMany(texts, ['u', 'v']);
  const U = compiledMany(ruTexts, ['u', 'v']);
  const V = compiledMany(rvTexts, ['u', 'v']);
  return {
    texts,
    r: (u, v) => R([u, v]),
    ru: (u, v) => U([u, v]),
    rv: (u, v) => V([u, v]),
    n: (u, v) => crossV(U([u, v]), V([u, v])),
    ruTexts,
    rvTexts,
  };
}

const rowTex = (v: readonly string[]) => `\\left(${v.map(tex).join(',\\ ')}\\right)`;

function crossText(a: readonly string[], b: readonly string[]): string[] {
  const t = (i: number, j: number) => `(${a[i]})*(${b[j]})-(${a[j]})*(${b[i]})`;
  return [sumText([t(1, 2)]), sumText([t(2, 0)]), sumText([t(0, 1)])];
}

export function surfaceIntegral(
  kind: 'flux' | 'scalar' | 'area',
  fieldText: string,
  surfaceText: string,
  rangeText: string,
): NumOut {
  const S = readSurface(surfaceText);
  const [u0, u1, v0, v1] = ranges(rangeText, 4, 'u, v');
  const normal = crossText(S.ruTexts, S.rvTexts);
  const steps: KitStep[] = [
    step('vcSurfaceStep', `\\mathbf{r}_u=${rowTex(S.ruTexts)},\\ \\mathbf{r}_v=${rowTex(S.rvTexts)}`),
    step('vcNormalStep', `\\mathbf{n}=\\mathbf{r}_u\\times\\mathbf{r}_v=${rowTex(normal)}`),
  ];
  let integrand: (u: number, v: number) => number;
  let lineKey: string;
  if (kind === 'flux') {
    const comps = components(fieldText, [3], 'F');
    comps.forEach((c) => checkNames(c, ['x', 'y', 'z']));
    const F = compiledMany(comps, ['x', 'y', 'z']);
    integrand = (u, v) => dotV(F(S.r(u, v)), S.n(u, v));
    lineKey = 'vcFlux';
    steps.push(
      step(
        'vcFluxStep',
        '\\iint_S\\mathbf{F}\\cdot d\\mathbf{S}=\\iint\\mathbf{F}(\\mathbf{r}(u,v))\\cdot(\\mathbf{r}_u\\times\\mathbf{r}_v)\\,du\\,dv',
      ),
    );
  } else if (kind === 'scalar') {
    checkNames(fieldText, ['x', 'y', 'z']);
    const f = compiled(fieldText, ['x', 'y', 'z']);
    integrand = (u, v) => f(S.r(u, v)) * normV(S.n(u, v));
    lineKey = 'vcSurfaceScalar';
    steps.push(
      step(
        'vcScalarSurfaceStep',
        '\\iint_S f\\,dS=\\iint f(\\mathbf{r}(u,v))\\,\\|\\mathbf{r}_u\\times\\mathbf{r}_v\\|\\,du\\,dv',
      ),
    );
  } else {
    integrand = (u, v) => normV(S.n(u, v));
    lineKey = 'vcArea';
    steps.push(step('vcAreaStep', 'A=\\iint\\|\\mathbf{r}_u\\times\\mathbf{r}_v\\|\\,du\\,dv'));
  }
  if (!Number.isFinite(integrand((u0 + u1) / 2, (v0 + v1) / 2))) throw new KitError('undefinedValue', 'integrand');
  const value = int2(integrand, u0, u1, v0, v1);
  steps.push(step('numValue', `${fmt(value, 12)}`));
  return {
    lines: [line(lineKey, { value: fmt(value, 12), pi: fmt(value / Math.PI, 8) })],
    tables: [],
    plots: [],
    fields: [],
    steps,
    latex: `\\iint=${fmt(value, 12)}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The divergence theorem
// ---------------------------------------------------------------------------------------------------------------

function divergenceFn(comps: readonly string[]): (p: readonly number[]) => number {
  const parts = comps.map((c, i) => compiled(partial(c, ['x', 'y', 'z'][i]), ['x', 'y', 'z']));
  return (p) => parts.reduce((s, f) => s + f(p), 0);
}

function sphereFlux(F: (p: number[]) => number[], R: number): number {
  return int2(
    (u, v) => {
      const nhat = [Math.sin(u) * Math.cos(v), Math.sin(u) * Math.sin(v), Math.cos(u)];
      return dotV(F(nhat.map((c) => R * c)), nhat) * R * R * Math.sin(u);
    },
    0,
    Math.PI,
    0,
    2 * Math.PI,
  );
}

function boxFlux(F: (p: number[]) => number[], [a, b, c, d, e, f]: number[]): number {
  const face = (axis: number, at: number, lo: [number, number], hi: [number, number], sign: number) =>
    sign *
    int2(
      (s, t) => {
        const p = [0, 0, 0];
        const others = [0, 1, 2].filter((i) => i !== axis);
        p[axis] = at;
        p[others[0]] = s;
        p[others[1]] = t;
        return F(p)[axis];
      },
      lo[0],
      hi[0],
      lo[1],
      hi[1],
    );
  return (
    face(0, b, [c, e], [d, f], 1) +
    face(0, a, [c, e], [d, f], -1) +
    face(1, d, [a, e], [b, f], 1) +
    face(1, c, [a, e], [b, f], -1) +
    face(2, f, [a, c], [b, d], 1) +
    face(2, e, [a, c], [b, d], -1)
  );
}

export function divergenceTheorem(
  fieldText: string,
  solid: 'sphere' | 'box',
  sphereText: string,
  boxText: string,
): NumOut {
  const comps = components(fieldText, [3], 'F');
  comps.forEach((c) => checkNames(c, ['x', 'y', 'z']));
  const F = compiledMany(comps, ['x', 'y', 'z']);
  const div = divergenceFn(comps);
  const divText = sumText(comps.map((c, i) => partial(c, ['x', 'y', 'z'][i])));
  let flux: number;
  let volume: number;
  if (solid === 'sphere') {
    const [R] = numbers(sphereText, 'radius');
    if (!(R > 0)) throw new KitError('vcRegion');
    flux = sphereFlux(F, R);
    volume = glBox(
      (rho, phi, theta) =>
        div([rho * Math.sin(phi) * Math.cos(theta), rho * Math.sin(phi) * Math.sin(theta), rho * Math.cos(phi)]) *
        rho *
        rho *
        Math.sin(phi),
      [
        [0, R],
        [0, Math.PI],
        [0, 2 * Math.PI],
      ],
    );
  } else {
    const b = ranges(boxText, 6, 'box');
    flux = boxFlux(F, b);
    volume = glBox(
      (x, y, z) => div([x, y, z]),
      [
        [b[0], b[1]],
        [b[2], b[3]],
        [b[4], b[5]],
      ],
    );
  }
  const diff = Math.abs(flux - volume);
  const steps = [
    step(
      'vcDivergenceStatement',
      '\\iint_{\\partial E}\\mathbf{F}\\cdot d\\mathbf{S}=\\iiint_{E}\\nabla\\cdot\\mathbf{F}\\,dV',
    ),
    step('vcDivergenceIntegrand', `\\nabla\\cdot\\mathbf{F}=${tex(divText)}`),
    step('vcGreenSides', `\\oiint=${fmt(flux, 12)},\\ \\iiint=${fmt(volume, 12)}`),
  ];
  return {
    lines: [
      line('vcDivergenceTheorem', {
        flux: fmt(flux, 12),
        volume: fmt(volume, 12),
        diff: fmt(diff, 3),
        pi: fmt(flux / Math.PI, 8),
      }),
    ],
    tables: [],
    plots: [],
    fields: [],
    steps,
    latex: `\\iint_{\\partial E}\\mathbf{F}\\cdot d\\mathbf{S}=${fmt(flux, 12)}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Stokes' theorem
// ---------------------------------------------------------------------------------------------------------------

export function stokesTheorem(fieldText: string, surfaceText: string, rangeText: string): NumOut {
  const comps = components(fieldText, [3], 'F');
  comps.forEach((c) => checkNames(c, ['x', 'y', 'z']));
  const S = readSurface(surfaceText);
  const [u0, u1, v0, v1] = ranges(rangeText, 4, 'u, v');
  const F = compiledMany(comps, ['x', 'y', 'z']);
  const d = (i: number, v: string) => compiled(partial(comps[i], v), ['x', 'y', 'z']);
  const curl = (p: readonly number[]) => [
    d(2, 'y')(p) - d(1, 'z')(p),
    d(0, 'z')(p) - d(2, 'x')(p),
    d(1, 'x')(p) - d(0, 'y')(p),
  ];
  // The boundary of the parameter rectangle, counterclockwise in (u, v), which matches the normal r_u x r_v.
  const alongU = (v: number) => int1((u) => dotV(F(S.r(u, v)), S.ru(u, v)), u0, u1);
  const alongV = (u: number) => int1((v) => dotV(F(S.r(u, v)), S.rv(u, v)), v0, v1);
  const circulation = alongU(v0) + alongV(u1) - alongU(v1) - alongV(u0);
  const flux = int2((u, v) => dotV(curl(S.r(u, v)), S.n(u, v)), u0, u1, v0, v1);
  const steps = [
    step(
      'vcStokesStatement',
      '\\oint_{\\partial S}\\mathbf{F}\\cdot d\\mathbf{r}=\\iint_{S}(\\nabla\\times\\mathbf{F})\\cdot d\\mathbf{S}',
    ),
    step('vcNormalStep', `\\mathbf{n}=\\mathbf{r}_u\\times\\mathbf{r}_v=${rowTex(crossText(S.ruTexts, S.rvTexts))}`),
    step('vcGreenSides', `\\oint=${fmt(circulation, 12)},\\ \\iint=${fmt(flux, 12)}`),
  ];
  return {
    lines: [
      line('vcStokes', {
        circulation: fmt(circulation, 12),
        flux: fmt(flux, 12),
        diff: fmt(Math.abs(circulation - flux), 3),
      }),
    ],
    tables: [],
    plots: [],
    fields: [],
    steps,
    latex: `\\oint_{\\partial S}\\mathbf{F}\\cdot d\\mathbf{r}=${fmt(circulation, 12)}`,
  };
}
