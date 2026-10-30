// Physical models as transfer functions, from their differential equations with zero initial conditions. Values are
// in SI: the window converts what the student types.
import { ControlError } from '../lib/errors';
import { step, type Step } from '../lib/steps';
import { fmt, makeTF, tfTex, type TF } from '../lib/tf';

export type ModelKind = 'msd' | 'rlc' | 'motor' | 'thermal' | 'tank';

export interface Model {
  readonly g: TF;
  readonly steps: Step[];
}

/** The parameters each model takes, in order, by field id. */
export const MODEL_FIELDS: Readonly<Record<ModelKind, readonly string[]>> = {
  msd: ['mass', 'damping', 'stiffness'],
  rlc: ['resistance', 'inductance', 'capacitance'],
  motor: ['inertia', 'friction', 'kt', 'resistance', 'inductance'],
  thermal: ['thermalR', 'thermalC'],
  tank: ['area', 'flowR'],
};

function positive(values: Readonly<Record<string, number>>, ids: readonly string[], zeroOk: readonly string[] = []) {
  for (const id of ids) {
    const v = values[id];
    if (!Number.isFinite(v) || v < 0 || (v === 0 && !zeroOk.includes(id))) {
      throw new ControlError(zeroOk.includes(id) ? 'paramNotNegative' : 'paramPositiveModel', { field: id });
    }
  }
}

export function model(kind: ModelKind, v: Readonly<Record<string, number>>): Model {
  if (kind === 'msd') {
    positive(v, ['mass', 'damping', 'stiffness'], ['damping', 'stiffness']);
    const g = makeTF([1], [v.stiffness, v.damping, v.mass]);
    return {
      g,
      steps: [
        step('model.msdLaw', {}, 'm\\ddot{x} + c\\dot{x} + kx = f(t)'),
        step('model.laplace', {}, `(${fmt(v.mass)}s^2 + ${fmt(v.damping)}s + ${fmt(v.stiffness)})X(s) = F(s)`),
        step('model.tf', { out: 'X', in: 'F' }, `\\frac{X(s)}{F(s)} = ${tfTex(g)}`),
      ],
    };
  }
  if (kind === 'rlc') {
    positive(v, ['resistance', 'inductance', 'capacitance'], ['resistance']);
    const { resistance: r, inductance: l, capacitance: c } = v;
    const g = makeTF([1], [1, r * c, l * c]);
    return {
      g,
      steps: [
        step('model.rlcLaw', {}, 'L\\frac{di}{dt} + Ri + v_C = v_{in},\\quad i = C\\frac{dv_C}{dt}'),
        step('model.laplace', {}, '(LCs^2 + RCs + 1)V_C(s) = V_{in}(s)'),
        step('model.tf', { out: 'V_C', in: 'V_in' }, `\\frac{V_C(s)}{V_{in}(s)} = ${tfTex(g)}`),
      ],
    };
  }
  if (kind === 'motor') {
    positive(v, ['inertia', 'friction', 'kt', 'resistance', 'inductance'], ['friction', 'inductance']);
    const { inertia: j, friction: b, kt: k, resistance: r, inductance: l } = v;
    // (Js + b)(Ls + R) + K²
    const g = makeTF([k], [b * r + k * k, j * r + b * l, j * l]);
    return {
      g,
      steps: [
        step('model.motorLaw', {}, 'J\\dot{\\omega} + b\\omega = K i,\\quad L\\frac{di}{dt} + Ri = v - K\\omega'),
        step('model.motorEliminate', {}, '\\frac{\\Omega(s)}{V(s)} = \\frac{K}{(Js + b)(Ls + R) + K^2}'),
        step('model.tf', { out: 'Ω', in: 'V' }, `\\frac{\\Omega(s)}{V(s)} = ${tfTex(g)}`),
      ],
    };
  }
  if (kind === 'thermal') {
    positive(v, ['thermalR', 'thermalC']);
    const { thermalR: r, thermalC: c } = v;
    const g = makeTF([r], [1, r * c]);
    return {
      g,
      steps: [
        step('model.thermalLaw', {}, 'C\\frac{dT}{dt} = q - \\frac{T}{R}'),
        step('model.tf', { out: 'T', in: 'Q' }, `\\frac{T(s)}{Q(s)} = \\frac{R}{RCs + 1} = ${tfTex(g)}`),
        step('model.timeConstant', { tau: fmt(r * c) }),
      ],
    };
  }
  positive(v, ['area', 'flowR']);
  const { area: a, flowR: r } = v;
  const g = makeTF([r], [1, a * r]);
  return {
    g,
    steps: [
      step('model.tankLaw', {}, 'A\\frac{dh}{dt} = q_{in} - \\frac{h}{R}'),
      step('model.tf', { out: 'H', in: 'Q_in' }, `\\frac{H(s)}{Q_{in}(s)} = \\frac{R}{ARs + 1} = ${tfTex(g)}`),
      step('model.timeConstant', { tau: fmt(a * r) }),
    ],
  };
}
