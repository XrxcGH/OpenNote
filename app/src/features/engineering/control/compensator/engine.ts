// Compensator design. Lead and lag compensators are designed in frequency for a phase margin, after a gain sets the
// error constant; a lead is also designed on the root locus for a damping ratio and settling time by the angle
// condition. PID gains come from the Ziegler-Nichols ultimate-gain table or from Skogestad's SIMC rules for a first
// order plus dead time model. Every design is checked by closing the loop and measuring it with the same engines
// the frequency and systems tools use.
import { ControlError } from '../lib/errors';
import { boundaryCrossings } from '../lib/locus';
import { brent } from '../lib/num';
import { pmul } from '../lib/poly';
import { step, type Step } from '../lib/steps';
import {
  cabs,
  cdiv,
  cx,
  errorConstants,
  evalTF,
  feedback,
  fmt,
  makeTF,
  pevalC,
  series,
  tfTex,
  type Complex,
  type TF,
} from '../lib/tf';
import { grid, makeLoop, margins, phaseDeg, type Margins } from '../frequency/engine';
import { stepSpecs, type Specs } from '../systems/engine';

const DEG = 180 / Math.PI;

export interface Check {
  readonly loop: TF;
  readonly closed: TF;
  readonly margins: Margins;
  /** Null when the closed loop is unstable or has no step specifications. */
  readonly specs: Specs | null;
}

/** Closes the unity loop around C·G and measures it. */
export function check(c: TF, g: TF): Check {
  const loop = series(c, g);
  const closed = feedback(loop);
  const l = makeLoop(loop);
  let specs: Specs | null = null;
  try {
    specs = stepSpecs(closed);
  } catch (error) {
    if (!(error instanceof ControlError)) throw error;
  }
  return { loop, closed, margins: margins(l, grid(l)), specs };
}

/** The gain that gives G the target error constant for its type (Kp, Kv, or Ka), or 1 with no target. */
export function gainForError(g: TF, target: number | undefined): { k: number; steps: Step[] } {
  if (target === undefined) return { k: 1, steps: [] };
  if (!(target > 0)) throw new ControlError('errorTarget');
  const e = errorConstants(g);
  if (e.type > 2) throw new ControlError('typeTooHigh');
  const now = [e.kp, e.kv, e.ka][e.type];
  if (!Number.isFinite(now) || now === 0) throw new ControlError('errorTarget');
  const k = target / now;
  const name = ['K_p', 'K_v', 'K_a'][e.type];
  return {
    k,
    steps: [
      step(
        'comp.gain',
        { name, now: fmt(now), target: fmt(target), k: fmt(k) },
        `K = \\frac{${fmt(target)}}{${fmt(now)}} = ${fmt(k)}`,
      ),
    ],
  };
}

/** The lead ratio α = (1 + sin φ)/(1 − sin φ) for a maximum phase lead φ. */
export const leadRatio = (phiDeg: number): number => {
  const s = Math.sin(phiDeg / DEG);
  return (1 + s) / (1 - s);
};

export interface Design {
  readonly c: TF;
  readonly steps: Step[];
  readonly before: Check;
  readonly after: Check;
  readonly values: Readonly<Record<string, number>>;
  /** True when a phase-margin design ends more than PM_SLACK below its target. */
  readonly missed?: boolean;
}

/** The frequency where |K G(jω)| has the given level in dB, searched on a log grid. */
function whereMagIs(g: TF, k: number, db: number): number {
  const l = makeLoop(g);
  const ws = grid(l, undefined, undefined, 2000);
  const f = (lw: number) => 20 * Math.log10(Math.abs(k) * cabs(evalTF(g, cx(0, 10 ** lw)))) - db;
  for (let i = 1; i < ws.length; i += 1) {
    const a = Math.log10(ws[i - 1]);
    const b = Math.log10(ws[i]);
    if (Math.sign(f(a)) !== Math.sign(f(b))) return 10 ** brent(f, a, b, 1e-14);
  }
  throw new ControlError('designNoFrequency');
}

/** The phase of G(jω) in degrees, continuous as the frequency tool draws it. */
const phaseAt = (g: TF, w: number): number => phaseDeg(makeLoop(g), w);

/** How far below its phase-margin target a finished design may end before it is flagged (degrees). */
export const PM_SLACK = 0.5;

const missedPm = (after: Check, pmTarget: number): boolean => !(after.margins.pm >= pmTarget - PM_SLACK);

/** A step saying the target was missed, and what to try, when the finished design falls short. */
const missedSteps = (after: Check, pmTarget: number): Step[] =>
  missedPm(after, pmTarget) ? [step('comp.missed', { pm: fmt(after.margins.pm), target: fmt(pmTarget) })] : [];

/** A lead compensator K(1 + s/z)/(1 + s/p) that adds the missing phase margin at the new crossover. */
export function designLead(g: TF, pmTarget: number, errorTarget?: number, extra = 5): Design {
  if (!(pmTarget > 0 && pmTarget < 90)) throw new ControlError('pmRange');
  const { k, steps } = gainForError(g, errorTarget);
  const kg = series(makeTF([k], [1]), g);
  const before = check(makeTF([k], [1]), g);
  const pm0 = before.margins.pm;
  const phi = pmTarget - (Number.isFinite(pm0) ? pm0 : 90) + extra;
  if (phi <= 0) throw new ControlError('leadNotNeeded', { pm: fmt(pm0) });
  if (phi >= 75) throw new ControlError('leadTooMuch', { phi: fmt(phi) });
  const alpha = leadRatio(phi);
  const wm = whereMagIs(kg, 1, -10 * Math.log10(alpha));
  const z = wm / Math.sqrt(alpha);
  const p = wm * Math.sqrt(alpha);
  const c = makeTF([k, k / z], [1, 1 / p]);
  const after = check(c, g);
  return {
    c,
    before,
    after,
    missed: missedPm(after, pmTarget),
    values: { k, alpha, phi, wm, z, p },
    steps: [
      ...steps,
      step('comp.pmNow', { pm: fmt(pm0) }),
      step(
        'comp.phiMax',
        { phi: fmt(phi), extra: fmt(extra) },
        `\\phi_{max} = ${fmt(pmTarget)}^\\circ - ${fmt(pm0)}^\\circ + ${fmt(extra)}^\\circ = ${fmt(phi)}^\\circ`,
      ),
      step(
        'comp.alpha',
        { alpha: fmt(alpha) },
        `\\alpha = \\frac{1 + \\sin\\phi_{max}}{1 - \\sin\\phi_{max}} = ${fmt(alpha)}`,
      ),
      step(
        'comp.wm',
        { wm: fmt(wm), db: fmt(-10 * Math.log10(alpha)) },
        `|KG(j\\omega_m)| = -10\\log_{10}\\alpha\\ \\text{dB}`,
      ),
      step(
        'comp.leadCorners',
        { z: fmt(z), p: fmt(p) },
        `z = \\frac{\\omega_m}{\\sqrt\\alpha} = ${fmt(z)},\\quad p = \\omega_m\\sqrt\\alpha = ${fmt(p)}`,
      ),
      step('comp.result', {}, `C(s) = ${tfTex(c)}`),
      step('comp.check', { pm: fmt(after.margins.pm), gm: fmt(after.margins.gm) }),
      ...missedSteps(after, pmTarget),
    ],
  };
}

/** A lag compensator K(1 + s/z)/(1 + s/p), p < z, that lowers the crossover to where the phase margin is met. */
export function designLag(g: TF, pmTarget: number, errorTarget?: number, extra = 5): Design {
  if (!(pmTarget > 0 && pmTarget < 90)) throw new ControlError('pmRange');
  const { k, steps } = gainForError(g, errorTarget);
  const kg = series(makeTF([k], [1]), g);
  const before = check(makeTF([k], [1]), g);
  const wantPhase = -180 + pmTarget + extra;
  const l = makeLoop(kg);
  const ws = grid(l, undefined, undefined, 2000);
  const f = (lw: number) => phaseAt(kg, 10 ** lw) - wantPhase;
  let wc = Number.NaN;
  for (let i = ws.length - 1; i > 0; i -= 1) {
    const a = Math.log10(ws[i - 1]);
    const b = Math.log10(ws[i]);
    if (Math.sign(f(a)) !== Math.sign(f(b))) {
      wc = 10 ** brent(f, a, b, 1e-14);
      break;
    }
  }
  if (!Number.isFinite(wc)) throw new ControlError('designNoFrequency');
  const beta = cabs(evalTF(kg, cx(0, wc)));
  if (beta <= 1) throw new ControlError('lagNotNeeded', { pm: fmt(before.margins.pm) });
  const z = wc / 10;
  const p = z / beta;
  const c = makeTF([k, k / z], [1, 1 / p]);
  const after = check(c, g);
  return {
    c,
    before,
    after,
    missed: missedPm(after, pmTarget),
    values: { k, beta, wc, z, p },
    steps: [
      ...steps,
      step('comp.pmNow', { pm: fmt(before.margins.pm) }),
      step('comp.lagCrossover', { phase: fmt(wantPhase), wc: fmt(wc), extra: fmt(extra) }),
      step('comp.beta', { beta: fmt(beta) }, `\\beta = |KG(j\\omega_c)| = ${fmt(beta)}`),
      step(
        'comp.lagCorners',
        { z: fmt(z), p: fmt(p) },
        `z = \\frac{\\omega_c}{10} = ${fmt(z)},\\quad p = \\frac{z}{\\beta} = ${fmt(p)}`,
      ),
      step('comp.result', {}, `C(s) = ${tfTex(c)}`),
      step('comp.check', { pm: fmt(after.margins.pm), gm: fmt(after.margins.gm) }),
      ...missedSteps(after, pmTarget),
    ],
  };
}

/** The lowest frequency where the continuous phase of G(jω) crosses the given angle, or NaN. */
function wherePhaseIs(g: TF, deg: number): number {
  const ws = grid(makeLoop(g), undefined, undefined, 2000);
  const f = (lw: number) => phaseAt(g, 10 ** lw) - deg;
  for (let i = 1; i < ws.length; i += 1) {
    const a = Math.log10(ws[i - 1]);
    const b = Math.log10(ws[i]);
    if (Math.sign(f(a)) !== Math.sign(f(b))) return 10 ** brent(f, a, b, 1e-14);
  }
  return Number.NaN;
}

/**
 * A lag-lead compensator K·lead·lag. K sets the error constant. The new crossover ω_c is where ∠KG = −180° (or,
 * when the phase never gets there, where a 50° lead would meet the target). The lead adds the missing phase at ω_c,
 * and the lag, a decade below ω_c, brings |C G(jω_c)| down to 1 without touching the error constant.
 */
export function designLeadLag(g: TF, pmTarget: number, errorTarget?: number, extra = 5): Design {
  if (!(pmTarget > 0 && pmTarget < 90)) throw new ControlError('pmRange');
  const { k, steps } = gainForError(g, errorTarget);
  const kg = series(makeTF([k], [1]), g);
  const before = check(makeTF([k], [1]), g);
  let wc = wherePhaseIs(kg, -180);
  if (!Number.isFinite(wc)) wc = wherePhaseIs(kg, -180 + pmTarget + extra - 50);
  if (!Number.isFinite(wc)) throw new ControlError('designNoFrequency');
  const pmAt = 180 + phaseAt(kg, wc);
  const phi = pmTarget + extra - pmAt;
  if (phi <= 0) throw new ControlError('leadNotNeeded', { pm: fmt(before.margins.pm) });
  if (phi >= 75) throw new ControlError('leadTooMuch', { phi: fmt(phi) });
  const alpha = leadRatio(phi);
  const z1 = wc / Math.sqrt(alpha);
  const p1 = wc * Math.sqrt(alpha);
  // With the lead's √α gain at ω_c, the lag must divide |KG(jω_c)|·√α down to 1. With its zero at ω_c/10,
  // |lag(jω_c)|² = (1 + 10²)/(1 + 10²β²), which gives β exactly.
  const m = cabs(evalTF(kg, cx(0, wc))) * Math.sqrt(alpha);
  if (m <= 1) throw new ControlError('lagNotNeeded', { pm: fmt(before.margins.pm) });
  const a = 10;
  const beta = Math.sqrt((m * m * (1 + a * a) - 1) / (a * a));
  const z2 = wc / a;
  const p2 = z2 / beta;
  const lagPhase = (Math.atan(wc / p2) - Math.atan(wc / z2)) * DEG;
  const c = makeTF(pmul([k, k / z1], [1, 1 / z2]), pmul([1, 1 / p1], [1, 1 / p2]));
  const after = check(c, g);
  return {
    c,
    before,
    after,
    missed: missedPm(after, pmTarget),
    values: { k, alpha, phi, wc, beta, z1, p1, z2, p2 },
    steps: [
      ...steps,
      step('comp.pmNow', { pm: fmt(before.margins.pm) }),
      step('comp.leadLagCrossover', { wc: fmt(wc), pm: fmt(pmAt) }),
      step(
        'comp.leadLagPhi',
        { phi: fmt(phi), extra: fmt(extra) },
        `\\phi_{max} = ${fmt(pmTarget)}^\\circ - ${fmt(pmAt)}^\\circ + ${fmt(extra)}^\\circ = ${fmt(phi)}^\\circ`,
      ),
      step(
        'comp.alpha',
        { alpha: fmt(alpha) },
        `\\alpha = \\frac{1 + \\sin\\phi_{max}}{1 - \\sin\\phi_{max}} = ${fmt(alpha)}`,
      ),
      step(
        'comp.leadCorners',
        { z: fmt(z1), p: fmt(p1) },
        `z_1 = \\frac{\\omega_c}{\\sqrt\\alpha} = ${fmt(z1)},\\quad p_1 = \\omega_c\\sqrt\\alpha = ${fmt(p1)}`,
      ),
      step(
        'comp.leadLagBeta',
        { beta: fmt(beta), lag: fmt(lagPhase) },
        `|KG(j\\omega_c)|\\sqrt\\alpha\\,\\sqrt{\\frac{1 + 10^2}{1 + 10^2\\beta^2}} = 1 \\Rightarrow \\beta = ${fmt(beta)}`,
      ),
      step(
        'comp.lagCorners',
        { z: fmt(z2), p: fmt(p2) },
        `z_2 = \\frac{\\omega_c}{10} = ${fmt(z2)},\\quad p_2 = \\frac{z_2}{\\beta} = ${fmt(p2)}`,
      ),
      step('comp.result', {}, `C(s) = ${tfTex(c)}`),
      step('comp.check', { pm: fmt(after.margins.pm), gm: fmt(after.margins.gm) }),
      ...missedSteps(after, pmTarget),
    ],
  };
}

/** A lead K(s + a)/(s + b) that puts closed-loop poles at s_d for a damping ratio ζ and 2% settling time tₛ. */
export function designLocusLead(g: TF, zeta: number, ts: number, zeroAt?: number): Design {
  if (!(zeta > 0 && zeta < 1)) throw new ControlError('zetaRange');
  if (!(ts > 0)) throw new ControlError('tsPositive');
  const wn = 4 / (zeta * ts);
  const sd: Complex = cx(-zeta * wn, wn * Math.sqrt(1 - zeta * zeta));
  const gAt = evalTF(g, sd);
  const angleG = Math.atan2(gAt.im, gAt.re) * DEG;
  // The angle the compensator must add so that ∠C G(s_d) = −180°.
  let deficit = -180 - angleG;
  deficit = ((((deficit + 180) % 360) + 360) % 360) - 180;
  if (deficit <= 1e-9) throw new ControlError('locusLeadNotNeeded', { deficit: fmt(deficit) });
  if (deficit >= 89) throw new ControlError('leadTooMuch', { phi: fmt(deficit) });
  const a = zeroAt ?? -sd.re;
  if (!(a > 0)) throw new ControlError('zeroPositive');
  const thetaZ = Math.atan2(sd.im, sd.re + a) * DEG;
  const thetaP = thetaZ - deficit;
  if (!(thetaP > 0.5)) throw new ControlError('zeroTooFar');
  const b = -sd.re + sd.im / Math.tan(thetaP / DEG);
  const c0 = makeTF([a, 1], [b, 1]);
  const k = 1 / cabs(cdiv(pevalC(c0.num, sd), pevalC(c0.den, sd))) / cabs(gAt);
  const c = makeTF([k * a, k], [b, 1]);
  const before = check(makeTF([1], [1]), g);
  const after = check(c, g);
  return {
    c,
    before,
    after,
    values: { wn, zeta, a, b, k, deficit, sdRe: sd.re, sdIm: sd.im },
    steps: [
      step(
        'comp.target',
        { wn: fmt(wn), zeta: fmt(zeta), ts: fmt(ts) },
        `\\omega_n = \\frac{4}{\\zeta t_s} = ${fmt(wn)},\\quad s_d = ${fmt(sd.re)} \\pm ${fmt(sd.im)}j`,
      ),
      step(
        'comp.deficit',
        { angle: fmt(angleG), deficit: fmt(deficit) },
        `\\phi_c = -180^\\circ - \\angle G(s_d) = ${fmt(deficit)}^\\circ`,
      ),
      step('comp.zero', { a: fmt(a), theta: fmt(thetaZ) }),
      step('comp.pole', { b: fmt(b), theta: fmt(thetaP) }),
      step(
        'comp.magnitude',
        { k: fmt(k) },
        `K = \\frac{1}{\\left|\\frac{s_d + ${fmt(a)}}{s_d + ${fmt(b)}} G(s_d)\\right|} = ${fmt(k)}`,
      ),
      step('comp.result', {}, `C(s) = ${tfTex(c)}`),
    ],
  };
}

export interface Pid {
  readonly kp: number;
  readonly ti: number;
  readonly td: number;
}

export interface ZnTable {
  readonly ku: number;
  readonly wu: number;
  readonly pu: number;
  readonly p: Pid;
  readonly pi: Pid;
  readonly pid: Pid;
  readonly steps: Step[];
}

/** The ultimate gain and frequency of a plant: where the gain K first puts closed-loop poles on the jω axis. */
export function ultimate(g: TF): { ku: number; wu: number } {
  const c = boundaryCrossings(g.num, g.den, 's').filter((x) => x.at > 0 && x.k > 0);
  if (!c.length) throw new ControlError('noUltimate');
  return { ku: c[0].k, wu: c[0].at };
}

/** The Ziegler-Nichols closed-loop (ultimate gain) table. */
export function zieglerNichols(ku: number, wu: number): ZnTable {
  if (!(ku > 0) || !(wu > 0)) throw new ControlError('ultimatePositive');
  const pu = (2 * Math.PI) / wu;
  return {
    ku,
    wu,
    pu,
    p: { kp: 0.5 * ku, ti: Infinity, td: 0 },
    pi: { kp: 0.45 * ku, ti: pu / 1.2, td: 0 },
    pid: { kp: 0.6 * ku, ti: pu / 2, td: pu / 8 },
    steps: [
      step('comp.pu', { pu: fmt(pu), wu: fmt(wu) }, `P_u = \\frac{2\\pi}{\\omega_u} = ${fmt(pu)}\\ \\text{s}`),
      step('comp.znTable', { ku: fmt(ku) }, `K_p = 0.6K_u,\\quad T_i = P_u/2,\\quad T_d = P_u/8`),
    ],
  };
}

/** Skogestad's SIMC PI(D) rules for K e^(−θs)/(τs + 1), with closed-loop time constant τ_c. */
export function simc(k: number, tau: number, theta: number, tauC: number): { pi: Pid; steps: Step[] } {
  if (!(k !== 0 && Number.isFinite(k))) throw new ControlError('modelGain');
  if (!(tau > 0) || !(theta >= 0)) throw new ControlError('modelTimes');
  if (!(tauC > 0)) throw new ControlError('tauCPositive');
  const kp = tau / (k * (tauC + theta));
  const ti = Math.min(tau, 4 * (tauC + theta));
  return {
    pi: { kp, ti, td: 0 },
    steps: [
      step('comp.simcKp', { kp: fmt(kp) }, `K_c = \\frac{\\tau}{K(\\tau_c + \\theta)} = ${fmt(kp)}`),
      step('comp.simcTi', { ti: fmt(ti) }, `T_i = \\min(\\tau,\\ 4(\\tau_c + \\theta)) = ${fmt(ti)}`),
    ],
  };
}

/** Kp(1 + 1/(Tᵢs) + T_d s) as a transfer function (an ideal derivative; Tᵢ = ∞ drops the integral). */
export function pidTF(p: Pid): TF {
  const i = Number.isFinite(p.ti) ? 1 / p.ti : 0;
  if (!i) return makeTF([p.kp, p.kp * p.td], [1]);
  return makeTF([p.kp * i, p.kp, p.kp * p.td], [0, 1]);
}
