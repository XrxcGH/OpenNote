// Spur gears and gear trains. A standard full-depth external pair (module or diametral pitch) gets its involute
// geometry, the contact ratio from the length of action, the interference limit, and tooth forces from the power.
// Simple and compound trains use the train value. Planetary trains use the tabular (superposition) method, checked
// by the Willis formula. SI inside: lengths in m, speeds in rad/s, angles in rad.
import { fail, finite, fmt, type MechStep, type Outcome } from '../types';
import { tex } from '../tex';

export interface GearPairInput {
  /** Module in m (a diametral pitch P in teeth per inch is a module of 0.0254 / P). */
  module: number;
  N1: number;
  N2: number;
  /** Pressure angle, rad. */
  phi: number;
  /** Addendum as a multiple of the module (1 for full depth). */
  addendum: number;
  /** Transmitted power, W (0 skips the forces). */
  power: number;
  /** Pinion speed, rad/s. */
  speed: number;
}

export interface GearPairResult {
  r1: number;
  r2: number;
  center: number;
  rb1: number;
  rb2: number;
  ra1: number;
  ra2: number;
  rf1: number;
  rf2: number;
  circularPitch: number;
  basePitch: number;
  ratio: number;
  contactLength: number;
  contactRatio: number;
  /** Fewest pinion teeth without interference for this gear ratio, as a real number and rounded up. */
  minTeeth: number;
  minTeethWhole: number;
  interference: boolean;
  speed2: number;
  forces: { torque: number; tangential: number; radial: number; total: number; pitchSpeed: number } | null;
  steps: MechStep[];
}

export const GEAR_DEFAULTS: GearPairInput = {
  module: 0.002,
  N1: 20,
  N2: 40,
  phi: (20 * Math.PI) / 180,
  addendum: 1,
  power: 5000,
  speed: (1500 * 2 * Math.PI) / 60,
};

/**
 * Fewest pinion teeth that mesh with a gear of ratio mG = NG / NP without interference (full depth when k = 1):
 * NP = 2k / ((1 + 2 mG) sin^2 phi) * (mG + sqrt(mG^2 + (1 + 2 mG) sin^2 phi)).
 */
export function minPinionTeeth(phi: number, mG: number, k = 1): number {
  const s2 = Math.sin(phi) ** 2;
  return ((2 * k) / ((1 + 2 * mG) * s2)) * (mG + Math.sqrt(mG * mG + (1 + 2 * mG) * s2));
}

/** Fewest teeth on a pinion that meshes with a rack: 2k / sin^2 phi. */
export const minRackTeeth = (phi: number, k = 1) => (2 * k) / Math.sin(phi) ** 2;

export function solveGearPair(input: GearPairInput): Outcome<GearPairResult> {
  const { module: m, N1, N2, phi, addendum, power, speed } = input;
  if (!finite(m, N1, N2, phi, addendum, power, speed)) return fail('notNumber');
  if (m <= 0) return fail('positiveModule');
  if (!Number.isInteger(N1) || !Number.isInteger(N2) || N1 < 5 || N2 < 5) return fail('wholeTeeth');
  if (!(phi > 0 && phi < Math.PI / 3)) return fail('pressureAngle');
  if (addendum <= 0 || addendum > 2) return fail('addendumRange');
  if (power < 0) return fail('negativePower');
  const a = addendum * m;
  const r1 = (m * N1) / 2,
    r2 = (m * N2) / 2;
  const center = r1 + r2;
  const rb1 = r1 * Math.cos(phi),
    rb2 = r2 * Math.cos(phi);
  const ra1 = r1 + a,
    ra2 = r2 + a;
  const rf1 = r1 - 1.25 * m,
    rf2 = r2 - 1.25 * m;
  const circularPitch = Math.PI * m;
  const basePitch = circularPitch * Math.cos(phi);
  const contactLength = Math.sqrt(ra1 ** 2 - rb1 ** 2) + Math.sqrt(ra2 ** 2 - rb2 ** 2) - center * Math.sin(phi);
  const contactRatio = contactLength / basePitch;
  const ratio = N2 / N1;
  // Interference is decided for the smaller gear against the larger one.
  const small = Math.min(N1, N2);
  const minTeeth = minPinionTeeth(phi, Math.max(N1, N2) / small, addendum);
  const minTeethWhole = Math.ceil(minTeeth - 1e-9);
  const interference = small < minTeeth - 1e-9;
  const speed2 = (speed * N1) / N2;
  const steps = pairSteps({ r1, r2, center, rb1, rb2, addendum, ra1, ra2, contactLength, basePitch, contactRatio });
  steps.push(interferenceStep({ interference, minTeeth, minTeethWhole, small, phi }));
  if (contactRatio < 1.2) steps.push({ key: 'gearLowContact' });
  let forces: GearPairResult['forces'] = null;
  if (power > 0) {
    if (speed <= 0) return fail('positiveSpeed');
    forces = toothForces(power, speed, r1, phi, steps);
  }
  return {
    ok: true,
    value: {
      r1,
      r2,
      center,
      rb1,
      rb2,
      ra1,
      ra2,
      rf1,
      rf2,
      circularPitch,
      basePitch,
      ratio,
      contactLength,
      contactRatio,
      minTeeth,
      minTeethWhole,
      interference,
      speed2,
      forces,
      steps,
    },
  };
}

/** The pitch, base, and addendum circles, and the contact along the line of action. */
function pairSteps(
  g: Record<
    | 'r1'
    | 'r2'
    | 'center'
    | 'rb1'
    | 'rb2'
    | 'addendum'
    | 'ra1'
    | 'ra2'
    | 'contactLength'
    | 'basePitch'
    | 'contactRatio',
    number
  >,
): MechStep[] {
  const { r1, r2, center, rb1, rb2, addendum, ra1, ra2, contactLength, basePitch, contactRatio } = g;
  return [
    {
      key: 'gearPitchCircles',
      math:
        `r = \\frac{mN}{2}:\\ r_1 = ${tex(r1 * 1000)}\\ \\mathrm{mm},\\ r_2 = ${tex(r2 * 1000)}\\ \\mathrm{mm},` +
        `\\quad C = r_1 + r_2 = ${tex(center * 1000)}\\ \\mathrm{mm}`,
    },
    {
      key: 'gearBaseCircles',
      math: `r_b = r\\cos\\phi:\\ r_{b1} = ${tex(rb1 * 1000)}\\ \\mathrm{mm},\\ r_{b2} = ${tex(rb2 * 1000)}\\ \\mathrm{mm}`,
    },
    {
      key: 'gearAddendum',
      math:
        `r_a = r + a,\\ a = ${tex(addendum)}m:\\ r_{a1} = ${tex(ra1 * 1000)}\\ \\mathrm{mm},\\ ` +
        `r_{a2} = ${tex(ra2 * 1000)}\\ \\mathrm{mm}`,
    },
    {
      key: 'gearContactLength',
      math: `Z = \\sqrt{r_{a1}^2 - r_{b1}^2} + \\sqrt{r_{a2}^2 - r_{b2}^2} - C\\sin\\phi = ${tex(contactLength * 1000)}\\ \\mathrm{mm}`,
    },
    {
      key: 'gearContactRatio',
      vars: { ratio: fmt(contactRatio, 4) },
      math:
        `m_c = \\frac{Z}{p_b} = \\frac{Z}{\\pi m\\cos\\phi} = ` +
        `\\frac{${tex(contactLength * 1000)}}{${tex(basePitch * 1000)}} = ${tex(contactRatio)}`,
    },
  ];
}

/** The fewest pinion teeth that mesh without interference, against the teeth there are. */
function interferenceStep(g: {
  interference: boolean;
  minTeeth: number;
  minTeethWhole: number;
  small: number;
  phi: number;
}): MechStep {
  const angle = fmt((g.phi * 180) / Math.PI, 4);
  return {
    key: g.interference ? 'gearInterference' : 'gearNoInterference',
    vars: { min: fmt(g.minTeeth, 4), whole: String(g.minTeethWhole), teeth: String(g.small), angle },
    math:
      `N_{P,\\min} = \\frac{2k}{(1+2m_G)\\sin^2\\phi}` +
      `\\left(m_G + \\sqrt{m_G^2 + (1+2m_G)\\sin^2\\phi}\\right) = ${tex(g.minTeeth, 4)}`,
  };
}

/** The torque on the pinion and the tangential, radial, and total tooth forces at the pitch point. */
function toothForces(power: number, speed: number, r1: number, phi: number, steps: MechStep[]) {
  const torque = power / speed;
  const tangential = torque / r1;
  const radial = tangential * Math.tan(phi);
  const total = tangential / Math.cos(phi);
  steps.push({
    key: 'gearForces',
    math:
      `T_1 = P/\\omega_1 = ${tex(torque)}\\ \\mathrm{N\\,m},\\ W_t = T_1/r_1 = ${tex(tangential)}\\ \\mathrm{N},\\ ` +
      `W_r = W_t\\tan\\phi = ${tex(radial)}\\ \\mathrm{N},\\ W = W_t/\\cos\\phi = ${tex(total)}\\ \\mathrm{N}`,
  });
  return { torque, tangential, radial, total, pitchSpeed: speed * r1 };
}

export interface TrainStage {
  driver: number;
  driven: number;
  /** An internal (ring) mesh keeps the direction; an external one reverses it. */
  internal: boolean;
}

export interface TrainResult {
  value: number;
  ratio: number;
  outputSpeed: number;
  /** Speed of each driven gear in turn, rad/s. */
  speeds: number[];
  steps: MechStep[];
}

/** A simple or compound train: each stage's driven gear shares a shaft with the next stage's driver. */
export function solveTrain(stages: readonly TrainStage[], inputSpeed: number): Outcome<TrainResult> {
  if (stages.length === 0) return fail('noStages');
  if (!finite(inputSpeed, ...stages.flatMap((s) => [s.driver, s.driven]))) return fail('notNumber');
  if (stages.some((s) => !Number.isInteger(s.driver) || !Number.isInteger(s.driven) || s.driver < 5 || s.driven < 5))
    return fail('wholeTeeth');
  let value = 1;
  const speeds: number[] = [];
  const factors: string[] = [];
  for (const s of stages) {
    const sign = s.internal ? 1 : -1;
    value *= (sign * s.driver) / s.driven;
    speeds.push(inputSpeed * value);
    factors.push(`\\left(${sign < 0 ? '-' : '+'}\\frac{${s.driver}}{${s.driven}}\\right)`);
  }
  const steps: MechStep[] = [
    {
      key: 'trainValue',
      math: `e = \\prod \\pm\\frac{N_\\text{driver}}{N_\\text{driven}} = ${factors.join('')} = ${tex(value, 6)}`,
    },
    {
      key: value < 0 ? 'trainReverses' : 'trainSameWay',
      math:
        `\\omega_\\text{out} = e\\,\\omega_\\text{in} = ${tex(value, 6)} \\times ${tex(inputSpeed)} = ` +
        `${tex(value * inputSpeed)}\\ \\mathrm{rad/s}`,
    },
  ];
  return { ok: true, value: { value, ratio: 1 / value, outputSpeed: value * inputSpeed, speeds, steps } };
}

export type Member = 'sun' | 'planet' | 'ring' | 'carrier';
export const MEMBERS: readonly Member[] = ['sun', 'planet', 'ring', 'carrier'];

export interface PlanetaryInput {
  sun: number;
  ring: number;
  /** Planet teeth; 0 takes (ring - sun) / 2. */
  planet: number;
  /** Number of planets, for the equal-spacing check; 0 skips it. */
  planets: number;
  fixed: Exclude<Member, 'planet'>;
  input: Exclude<Member, 'planet'>;
  output: Member;
  inputSpeed: number;
}

export interface PlanetaryResult {
  planet: number;
  speeds: Record<Member, number>;
  /** Input speed over output speed. */
  ratio: number;
  /** Rows of the tabular method: locked, carrier held, total. */
  table: { row: 'locked' | 'held' | 'total'; values: Record<Member, number> }[];
  /** Willis: (w_ring - w_carrier) / (w_sun - w_carrier) = -Ns / Nr, as a residual. */
  willisResidual: number;
  spacingOk: boolean | null;
  steps: MechStep[];
}

export const PLANETARY_DEFAULTS: PlanetaryInput = {
  sun: 30,
  ring: 90,
  planet: 0,
  planets: 3,
  fixed: 'ring',
  input: 'sun',
  output: 'carrier',
  inputSpeed: 100,
};

export function solvePlanetary(input: PlanetaryInput): Outcome<PlanetaryResult> {
  const { sun: Ns, ring: Nr, fixed, input: inMember, output, inputSpeed } = input;
  if (!finite(Ns, Nr, input.planet, input.planets, inputSpeed)) return fail('notNumber');
  const Np = input.planet === 0 ? (Nr - Ns) / 2 : input.planet;
  if (![Ns, Nr, Np].every((n) => Number.isInteger(n) && n >= 5)) return fail('wholeTeeth');
  if (Nr !== Ns + 2 * Np) return fail('planetFit', { sun: String(Ns), planet: String(Np), ring: String(Nr) });
  if (inMember === output || inMember === fixed || output === fixed) return fail('planetMembers');
  // Speeds relative to the carrier are in the ratios of a train with the carrier held.
  const rel: Record<Member, number> = { sun: 1, planet: -Ns / Np, ring: -Ns / Nr, carrier: 0 };
  const speedsFor = (x: number, scale: number): Record<Member, number> => ({
    sun: x + scale * rel.sun,
    planet: x + scale * rel.planet,
    ring: x + scale * rel.ring,
    carrier: x,
  });
  // Total = locked x + held s * rel, with the fixed member at zero: s = -x / rel[fixed] (or x = 0 if the carrier is fixed).
  let x: number, s: number;
  if (fixed === 'carrier') {
    x = 0;
    s = inputSpeed / rel[inMember];
  } else {
    const perX = speedsFor(1, -1 / rel[fixed]);
    x = inputSpeed / perX[inMember];
    s = -x / rel[fixed];
  }
  const speeds = speedsFor(x, s);
  const locked: Record<Member, number> = { sun: x, planet: x, ring: x, carrier: x };
  const held: Record<Member, number> = { sun: s * rel.sun, planet: s * rel.planet, ring: s * rel.ring, carrier: 0 };
  if (Math.abs(speeds[output]) < 1e-12 * Math.abs(inputSpeed)) return fail('outputStill');
  const ratio = inputSpeed / speeds[output];
  const willisResidual = speeds.ring - speeds.carrier + (Ns / Nr) * (speeds.sun - speeds.carrier);
  const spacingOk = input.planets > 0 ? Number.isInteger((Ns + Nr) / input.planets) : null;
  const steps: MechStep[] = [
    { key: 'planetTeeth', math: `N_r = N_s + 2N_p:\\ ${Nr} = ${Ns} + 2 \\times ${Np}` },
    { key: 'planetLocked', vars: { x: fmt(x) } },
    { key: 'planetHeld', vars: { member: fixed } },
    {
      key: 'planetWillis',
      math: `\\frac{\\omega_r - \\omega_c}{\\omega_s - \\omega_c} = -\\frac{N_s}{N_r} = ${tex(-Ns / Nr)}`,
    },
    {
      key: 'planetRatio',
      math: `\\frac{\\omega_\\text{in}}{\\omega_\\text{out}} = \\frac{${tex(inputSpeed)}}{${tex(speeds[output])}} = ${tex(ratio, 6)}`,
    },
  ];
  if (spacingOk !== null)
    steps.push({ key: spacingOk ? 'planetSpacingOk' : 'planetSpacingBad', vars: { count: String(input.planets) } });
  return {
    ok: true,
    value: {
      planet: Np,
      speeds,
      ratio,
      table: [
        { row: 'locked', values: locked },
        { row: 'held', values: held },
        { row: 'total', values: speeds },
      ],
      willisResidual,
      spacingOk,
      steps,
    },
  };
}
