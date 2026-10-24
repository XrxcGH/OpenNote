// Airfoils: an NACA or typed section, thin airfoil theory for its zero-lift angle, lift, and moment, and the vortex
// panel method for its pressure distribution, with the worked steps a student follows by hand.
import { AeroError, DEG, eq, finite, num, step, tex } from '../common';
import type { AeroStep, XY } from '../common';
import { STATIONS, panelNodes, surfaceAt } from './geometry';
import type { Section, SurfacePoint } from './geometry';
import { vortexPanel } from './panel';
import type { PanelResult } from './panel';
import { thinAirfoil } from './thin';
import type { ThinResult } from './thin';

export interface AirfoilInput {
  readonly section: Section;
  /** Angle of attack, degrees. */
  readonly alpha: number;
  readonly panels: number;
  readonly closed: boolean;
}

export interface AirfoilResult {
  readonly thin: ThinResult;
  /** Undefined for a section with no thickness, which panels cannot model. */
  readonly panel?: PanelResult;
  readonly table: readonly SurfacePoint[];
  readonly outline: readonly XY[];
  readonly camberLine: readonly XY[];
  readonly steps: readonly AeroStep[];
}

function checkPanels(panels: number): void {
  finite(panels, 'N');
  if (!(Number.isInteger(panels) && panels % 2 === 0 && panels >= 20 && panels <= 400))
    throw new AeroError('panelCount');
}

const degrees = (radians: number) => `${tex(radians / DEG, 5)}^\\circ`;

function slopeStep(section: Section): AeroStep {
  if (section.m === 0 && section.family !== 'five') return step('afSlopeFlat', '\\dfrac{dz}{dx} = 0');
  if (section.family === 'five') {
    const vars = { r: num(section.kink, 4), cli: num(section.cli ?? 0, 3) };
    if (section.reflex) return step('afSlopeReflex', undefined, vars);
    return step(
      'afSlopeFive',
      '\\dfrac{dz}{dx} = \\tfrac{k_1}{6}\\left(3x^2 - 6rx + r^2(3 - r)\\right)\\ (x < r),\\quad ' +
        '-\\tfrac{k_1}{6}r^3\\ (x \\ge r)',
      vars,
    );
  }
  return step(
    'afSlopeFour',
    '\\dfrac{dz}{dx} = \\dfrac{2m}{p^2}(p - x)\\ (x < p),\\quad \\dfrac{2m}{(1 - p)^2}(p - x)\\ (x \\ge p)',
    { m: num(section.m, 4), p: num(section.p, 4) },
  );
}

function thinSteps(section: Section, alpha: number, thin: ThinResult): AeroStep[] {
  const a = alpha * DEG;
  const kink = thin.thetaKink > 0 ? { thetaK: num(thin.thetaKink / DEG, 5) } : undefined;
  return [
    slopeStep(section),
    step(kink ? 'afThetaKink' : 'afTheta', '\\dfrac{x}{c} = \\tfrac{1}{2}\\left(1 - \\cos\\theta\\right)', kink ?? {}),
    step(
      'afAlphaL0',
      eq(
        '\\alpha_{L=0}',
        '-\\dfrac{1}{\\pi}\\int_0^\\pi \\dfrac{dz}{dx}\\left(\\cos\\theta - 1\\right)d\\theta',
        `${tex(thin.alphaL0, 6)}\\ \\mathrm{rad}`,
        degrees(thin.alphaL0),
      ),
    ),
    step(
      'afCoefficients',
      `A_0 = \\alpha - \\dfrac{1}{\\pi}\\int_0^\\pi \\dfrac{dz}{dx}d\\theta = ${tex(thin.A0, 5)},\\quad ` +
        `A_n = \\dfrac{2}{\\pi}\\int_0^\\pi \\dfrac{dz}{dx}\\cos n\\theta\\,d\\theta:\\ ` +
        `A_1 = ${tex(thin.A1, 5)},\\ A_2 = ${tex(thin.A2, 5)}`,
      { alpha: num(a, 5) },
    ),
    step(
      'afCl',
      eq('c_l', '\\pi\\left(2A_0 + A_1\\right)', '2\\pi\\left(\\alpha - \\alpha_{L=0}\\right)', tex(thin.cl, 5)),
    ),
    step('afCm', eq('c_{m,c/4}', '\\tfrac{\\pi}{4}\\left(A_2 - A_1\\right)', tex(thin.cmQuarter, 5))),
  ];
}

function panelSteps(r: PanelResult): AeroStep[] {
  const steps = [
    step(
      'afPanel',
      "\\sum_{j=1}^{N+1} A^n_{ij}\\gamma'_j = \\sin\\left(\\theta_i - \\alpha\\right),\\quad " +
        "\\gamma'_1 + \\gamma'_{N+1} = 0",
      { N: String(r.panels), N1: String(r.panels + 1) },
    ),
    step('afPanelCl', eq('c_l', '\\dfrac{2\\Gamma}{V_\\infty c}', tex(r.cl, 5)), { clP: num(r.clPressure, 5) }),
  ];
  steps.push(
    step('afCp', eq('C_p', '1 - \\left(V_t/V_\\infty\\right)^2'), {
      cpMin: num(r.cpMin, 4),
      at: num(r.cpMinAt, 3),
      stag: r.stagnation ? num(r.stagnation.x, 3) : '—',
    }),
  );
  return steps;
}

export function airfoil(input: AirfoilInput): AirfoilResult {
  const alpha = finite(input.alpha, 'α');
  checkPanels(input.panels);
  const { section, closed } = input;
  const thin = thinAirfoil(section, alpha * DEG);
  const panel =
    section.t > 0
      ? (() => {
          const nodes = panelNodes(section, input.panels, closed);
          return vortexPanel(nodes.X, nodes.Y, alpha * DEG);
        })()
      : undefined;
  const outlineNodes = panelNodes(section, 160, closed);
  const steps = [
    step('afSection', undefined, {
      name: section.name,
      t: num(section.t, 4),
      m: num(section.m, 4),
      p: num(section.p, 4),
      a4: closed ? '0.1036' : '0.1015',
    }),
    ...thinSteps(section, alpha, thin),
    ...(panel ? panelSteps(panel) : []),
  ];
  return {
    thin,
    ...(panel ? { panel } : {}),
    table: STATIONS.map((x) => surfaceAt(section, x, closed)),
    outline: outlineNodes.X.map((x, i) => ({ x, y: outlineNodes.Y[i]! })),
    camberLine: Array.from({ length: 81 }, (_, i) => {
      const x = 0.5 * (1 - Math.cos((Math.PI * i) / 80));
      return { x, y: section.camber(x) };
    }),
    steps,
  };
}
