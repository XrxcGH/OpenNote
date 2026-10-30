// Stress and strain at a point. Plane stress by the Mohr's circle formulas, a full 3D tensor by its eigenvalues,
// strain rosettes to strains and then by plane-stress Hooke's law to stresses, and the failure criteria on the three
// principal stresses. Tension is positive, a positive shear acts on the +x face in +y, and angles turn from x
// toward y (counterclockwise). Everything is in base SI: Pa, strain as a plain number, angles in radians.
import { symmetricEigen, tidy } from '../kit/numeric';
import { fail, finite, positive, q, step, type KitStep } from '../kit/types';

export interface PlaneStress {
  readonly sx: number;
  readonly sy: number;
  readonly txy: number;
}

export interface PlaneResult {
  readonly C: number;
  readonly R: number;
  readonly s1: number;
  readonly s2: number;
  /** The angle from x to the direction of s1. */
  readonly thetaP: number;
  /** The angle from x to the face of the largest in-plane shear (positive shear on it). */
  readonly thetaS: number;
  readonly rotated?: { readonly sx: number; readonly sy: number; readonly txy: number };
  readonly steps: KitStep[];
}

/** The stresses on an element turned by theta. */
export function rotate(s: PlaneStress, theta: number) {
  const C = (s.sx + s.sy) / 2;
  const h = (s.sx - s.sy) / 2;
  const [c2, s2] = [Math.cos(2 * theta), Math.sin(2 * theta)];
  return { sx: C + h * c2 + s.txy * s2, sy: C - h * c2 - s.txy * s2, txy: -h * s2 + s.txy * c2 };
}

export function planeStress(s: PlaneStress, theta?: number): PlaneResult {
  const sx = finite(s.sx, 'σx');
  const sy = finite(s.sy, 'σy');
  const txy = finite(s.txy, 'τxy');
  const scale = Math.abs(sx) + Math.abs(sy) + Math.abs(txy);
  const C = (sx + sy) / 2;
  const R = Math.hypot((sx - sy) / 2, txy);
  const thetaP = R === 0 ? 0 : Math.atan2(2 * txy, sx - sy) / 2;
  const thetaS = thetaP - Math.PI / 4;
  const steps: KitStep[] = [
    step('stress.center', 'C = \\frac{\\sigma_x + \\sigma_y}{2} = \\frac{[[sx]] + ([[sy]])}{2} = [[C]]', {
      sx: q(sx, 'stress'),
      sy: q(sy, 'stress'),
      C: q(C, 'stress'),
    }),
    step(
      'stress.radius',
      'R = \\sqrt{\\left(\\frac{\\sigma_x - \\sigma_y}{2}\\right)^2 + \\tau_{xy}^2} = ' +
        '\\sqrt{\\left(\\frac{[[sx]] - ([[sy]])}{2}\\right)^2 + ([[txy]])^2} = [[R]]',
      { sx: q(sx, 'stress'), sy: q(sy, 'stress'), txy: q(txy, 'stress'), R: q(R, 'stress') },
    ),
    step('stress.principal', '\\sigma_{1,2} = C \\pm R = [[s1]],\\ [[s2]]', {
      s1: q(tidy(C + R, scale), 'stress'),
      s2: q(tidy(C - R, scale), 'stress'),
    }),
    step('stress.angle', '\\theta_p = \\tfrac12 \\operatorname{atan2}(2\\tau_{xy},\\ \\sigma_x - \\sigma_y) = [[tp]]', {
      tp: q(thetaP, 'angle'),
    }),
    step('stress.shear', '\\tau_{max} = R = [[R]], \\quad \\theta_s = \\theta_p - 45^{\\circ} = [[ts]]', {
      R: q(R, 'stress'),
      ts: q(thetaS, 'angle'),
    }),
  ];
  const result: PlaneResult = { C, R, s1: tidy(C + R, scale), s2: tidy(C - R, scale), thetaP, thetaS, steps };
  if (theta === undefined || !Number.isFinite(theta)) return result;
  const turned = rotate({ sx, sy, txy }, theta);
  const rotated = { sx: tidy(turned.sx, scale), sy: tidy(turned.sy, scale), txy: tidy(turned.txy, scale) };
  steps.push(
    step(
      'stress.rotated',
      "\\sigma_{x'} = C + \\frac{\\sigma_x - \\sigma_y}{2}\\cos 2\\theta + \\tau_{xy}\\sin 2\\theta = [[a]], \\quad " +
        "\\sigma_{y'} = [[b]], \\quad \\tau_{x'y'} = -\\frac{\\sigma_x - \\sigma_y}{2}\\sin 2\\theta + " +
        '\\tau_{xy}\\cos 2\\theta = [[c]]',
      { theta: q(theta, 'angle'), a: q(rotated.sx, 'stress'), b: q(rotated.sy, 'stress'), c: q(rotated.txy, 'stress') },
    ),
  );
  return { ...result, rotated };
}

export type Tensor = readonly [readonly number[], readonly number[], readonly number[]];

export interface TensorResult {
  readonly values: [number, number, number];
  /** Unit directions of the principal stresses, one row for each, in the order of `values`. */
  readonly directions: [number, number, number][];
  readonly invariants: [number, number, number];
  readonly steps: KitStep[];
}

export function tensorStress(t: Tensor): TensorResult {
  for (const row of t) for (const value of row) finite(value, 'σ');
  if (t[0][1] !== t[1][0] || t[0][2] !== t[2][0] || t[1][2] !== t[2][1]) fail('notSymmetric');
  const scale = t.flat().reduce((sum, value) => sum + Math.abs(value), 0);
  const I1 = t[0][0] + t[1][1] + t[2][2];
  const I2 = t[0][0] * t[1][1] + t[1][1] * t[2][2] + t[2][2] * t[0][0] - t[0][1] ** 2 - t[1][2] ** 2 - t[0][2] ** 2;
  const I3 =
    t[0][0] * (t[1][1] * t[2][2] - t[1][2] ** 2) -
    t[0][1] * (t[0][1] * t[2][2] - t[1][2] * t[0][2]) +
    t[0][2] * (t[0][1] * t[1][2] - t[1][1] * t[0][2]);
  const { values, vectors } = symmetricEigen(t);
  const principal = values.map((value) => tidy(value, scale)) as [number, number, number];
  const directions = [0, 1, 2].map((i) => {
    const d = [vectors[0][i], vectors[1][i], vectors[2][i]];
    // Each direction points so that its largest component is positive, so the answer does not depend on rounding.
    const big = d.reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), 0);
    return d.map((value) => tidy(Math.sign(big || 1) * value, 1)) as [number, number, number];
  });
  const steps = [
    step('stress.invariants', 'I_1 = [[I1]], \\quad I_2 = [[I2]], \\quad I_3 = [[I3]]', {
      I1: q(I1, 'stress'),
      I2: q(I2, 'stress2'),
      I3: q(I3, 'stress3'),
    }),
    step('stress.cubic', '\\sigma^3 - I_1\\sigma^2 + I_2\\sigma - I_3 = 0'),
    step('stress.roots', '\\sigma_1 = [[a]], \\quad \\sigma_2 = [[b]], \\quad \\sigma_3 = [[c]]', {
      a: q(principal[0], 'stress'),
      b: q(principal[1], 'stress'),
      c: q(principal[2], 'stress'),
    }),
  ];
  return { values: principal, directions, invariants: [I1, I2, I3], steps };
}

export type RosetteType = 'rect' | 'delta';

export interface RosetteResult {
  readonly ex: number;
  readonly ey: number;
  readonly gxy: number;
  readonly e1: number;
  readonly e2: number;
  readonly thetaP: number;
  readonly gammaMax: number;
  readonly steps: KitStep[];
}

/** Strains from a rosette: the first gauge lies along x, then the others at 45 and 90 degrees or 60 and 120. */
export function rosette(type: RosetteType, ea: number, eb: number, ec: number): RosetteResult {
  finite(ea, 'εa');
  finite(eb, 'εb');
  finite(ec, 'εc');
  const ex = ea;
  const ey = type === 'rect' ? ec : (2 * eb + 2 * ec - ea) / 3;
  const gxy = type === 'rect' ? 2 * eb - ea - ec : (2 * (eb - ec)) / Math.sqrt(3);
  const scale = Math.abs(ea) + Math.abs(eb) + Math.abs(ec);
  const C = (ex + ey) / 2;
  const R = Math.hypot((ex - ey) / 2, gxy / 2);
  const thetaP = R === 0 ? 0 : Math.atan2(gxy, ex - ey) / 2;
  const e1 = tidy(C + R, scale);
  const e2 = tidy(C - R, scale);
  const strain = (v: number) => q(tidy(v, scale), 'strain');
  const steps = [
    type === 'rect'
      ? step(
          'stress.rect',
          '\\varepsilon_x = \\varepsilon_a = [[ex]], \\quad \\varepsilon_y = \\varepsilon_c = [[ey]], \\quad ' +
            '\\gamma_{xy} = 2\\varepsilon_b - \\varepsilon_a - \\varepsilon_c = [[g]]',
          { ex: strain(ex), ey: strain(ey), g: strain(gxy) },
        )
      : step(
          'stress.delta',
          '\\varepsilon_x = \\varepsilon_a = [[ex]], \\quad \\varepsilon_y = \\tfrac13(2\\varepsilon_b + ' +
            '2\\varepsilon_c - \\varepsilon_a) = [[ey]], \\quad \\gamma_{xy} = \\tfrac{2}{\\sqrt3}' +
            '(\\varepsilon_b - \\varepsilon_c) = [[g]]',
          { ex: strain(ex), ey: strain(ey), g: strain(gxy) },
        ),
    step(
      'stress.strainPrincipal',
      '\\varepsilon_{1,2} = \\frac{\\varepsilon_x + \\varepsilon_y}{2} \\pm \\sqrt{\\left(\\frac{\\varepsilon_x - ' +
        '\\varepsilon_y}{2}\\right)^2 + \\left(\\frac{\\gamma_{xy}}{2}\\right)^2} = [[e1]],\\ [[e2]]',
      { e1: strain(e1), e2: strain(e2) },
    ),
    step(
      'stress.strainAngle',
      '\\theta_p = \\tfrac12 \\operatorname{atan2}(\\gamma_{xy},\\ \\varepsilon_x - \\varepsilon_y) = [[tp]]',
      { tp: q(thetaP, 'angle') },
    ),
  ];
  return { ex, ey: tidy(ey, scale), gxy: tidy(gxy, scale), e1, e2, thetaP, gammaMax: 2 * R, steps };
}

/** Plane-stress Hooke's law: the stresses that go with strains in the plane, for an isotropic material. */
export function hookePlane(ex: number, ey: number, gxy: number, E: number, nu: number) {
  positive(E, 'E');
  if (!Number.isFinite(nu) || nu <= -1 || nu >= 0.5) fail('poisson');
  const k = E / (1 - nu * nu);
  const G = E / (2 * (1 + nu));
  const stress = { sx: k * (ex + nu * ey), sy: k * (ey + nu * ex), txy: G * gxy };
  const s = step(
    'stress.hooke',
    '\\sigma_x = \\frac{E}{1-\\nu^2}(\\varepsilon_x + \\nu\\varepsilon_y) = [[sx]], \\quad \\sigma_y = ' +
      '\\frac{E}{1-\\nu^2}(\\varepsilon_y + \\nu\\varepsilon_x) = [[sy]], \\quad \\tau_{xy} = G\\gamma_{xy} = [[t]]',
    { sx: q(stress.sx, 'stress'), sy: q(stress.sy, 'stress'), t: q(stress.txy, 'stress'), G: q(G, 'modulus') },
  );
  return { ...stress, G, step: s };
}

export interface Strengths {
  /** Yield strength, for the ductile criteria. */
  readonly Sy?: number;
  /** Ultimate strengths in tension and compression, for the brittle criteria. */
  readonly Sut?: number;
  readonly Suc?: number;
}

export interface CriteriaResult {
  readonly vonMises: number;
  readonly tresca: number;
  readonly tauMax: number;
  readonly nVonMises?: number;
  readonly nTresca?: number;
  readonly nNormal?: number;
  readonly nMohr?: number;
  readonly steps: KitStep[];
}

const has = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);

/** The failure criteria on three principal stresses, in any order. */
export function criteria(principal: readonly number[], strengths: Strengths): CriteriaResult {
  const [s1, s2, s3] = [...principal].sort((a, b) => b - a);
  const vonMises = Math.sqrt(((s1 - s2) ** 2 + (s2 - s3) ** 2 + (s3 - s1) ** 2) / 2);
  const tresca = s1 - s3;
  const steps: KitStep[] = [
    step(
      'stress.vonMises',
      "\\sigma' = \\sqrt{\\tfrac12\\left[(\\sigma_1-\\sigma_2)^2 + (\\sigma_2-\\sigma_3)^2 + (\\sigma_3-\\sigma_1)^2\\right]} = [[vm]]",
      { vm: q(vonMises, 'stress') },
    ),
    step('stress.tresca', '\\tau_{abs} = \\frac{\\sigma_1 - \\sigma_3}{2} = [[t]]', {
      t: q(tresca / 2, 'stress'),
      s1: q(s1, 'stress'),
      s3: q(s3, 'stress'),
    }),
  ];
  const out: { -readonly [K in keyof CriteriaResult]: CriteriaResult[K] } = {
    vonMises,
    tresca,
    tauMax: tresca / 2,
    steps,
  };
  if (has(strengths.Sy)) {
    const Sy = positive(strengths.Sy, 'S_y');
    out.nVonMises = vonMises === 0 ? Infinity : Sy / vonMises;
    out.nTresca = tresca === 0 ? Infinity : Sy / tresca;
    steps.push(
      step('stress.nVonMises', "n = \\frac{S_y}{\\sigma'} = \\frac{[[Sy]]}{[[vm]]} = [[n]]", {
        Sy: q(Sy, 'stress'),
        vm: q(vonMises, 'stress'),
        n: out.nVonMises,
      }),
      step('stress.nTresca', 'n = \\frac{S_y}{\\sigma_1 - \\sigma_3} = \\frac{[[Sy]]}{[[d]]} = [[n]]', {
        Sy: q(Sy, 'stress'),
        d: q(tresca, 'stress'),
        n: out.nTresca,
      }),
    );
  }
  if (has(strengths.Sut)) {
    const Sut = positive(strengths.Sut, 'S_ut');
    const Suc = has(strengths.Suc) ? positive(strengths.Suc, 'S_uc') : Sut;
    out.nNormal = Math.min(s1 > 0 ? Sut / s1 : Infinity, s3 < 0 ? Suc / -s3 : Infinity);
    out.nMohr = mohrCoulomb(s1, s3, Sut, Suc);
    steps.push(
      step(
        'stress.nNormal',
        'n = \\min\\left(\\frac{S_{ut}}{\\sigma_1},\\ \\frac{S_{uc}}{|\\sigma_3|}\\right) = [[n]]',
        { n: out.nNormal },
      ),
      step('stress.nMohr', '\\frac{\\sigma_1}{S_{ut}} - \\frac{\\sigma_3}{S_{uc}} = \\frac{1}{n}, \\quad n = [[n]]', {
        n: out.nMohr,
      }),
    );
  }
  return out;
}

/** Coulomb-Mohr for a brittle material: the line between the tension and compression circles. */
function mohrCoulomb(s1: number, s3: number, Sut: number, Suc: number): number {
  if (s3 >= 0) return s1 === 0 ? Infinity : Sut / s1;
  if (s1 <= 0) return Suc / -s3;
  return 1 / (s1 / Sut - s3 / Suc);
}
