// Special relativity in closed form: the Lorentz factor, the Lorentz transformation of an event, velocity addition,
// a particle's energy and momentum, and the relativistic Doppler factor. Speeds are fractions of c (beta), and the
// forms used stay exact as beta nears 1: 1 - beta² is worked out as (1 - beta)(1 + beta), and gamma - 1 without
// subtracting.
import { fail } from '../kit/read';

const checkBeta = (beta: number) => {
  if (!(Math.abs(beta) < 1)) fail('kitPhysics.relativity.errors.speed');
};

/** gamma = 1 / sqrt(1 - beta²). */
export function lorentzFactor(beta: number): number {
  checkBeta(beta);
  return 1 / Math.sqrt((1 - beta) * (1 + beta));
}

/** gamma - 1, accurate at small speeds: beta² / (s (1 + s)) with s = sqrt(1 - beta²). */
export function gammaMinusOne(beta: number): number {
  checkBeta(beta);
  const s = Math.sqrt((1 - beta) * (1 + beta));
  return (beta * beta) / (s * (1 + s));
}

/** beta from gamma: sqrt((gamma - 1)(gamma + 1)) / gamma. */
export const betaOfGamma = (gamma: number): number => Math.sqrt((gamma - 1) * (gamma + 1)) / gamma;

/** Rapidity, atanh(beta). */
export const rapidity = (beta: number): number => Math.atanh(beta);

export interface Boosted {
  gamma: number;
  t: number;
  x: number;
}

/** An event (t, x) seen from a frame moving at beta c along +x: t' = gamma (t - beta x / c), x' = gamma (x - beta c t). */
export function lorentzBoost(t: number, x: number, beta: number, c: number): Boosted {
  const gamma = lorentzFactor(beta);
  return { gamma, t: gamma * (t - (beta * x) / c), x: gamma * (x - beta * c * t) };
}

export type IntervalKind = 'timelike' | 'spacelike' | 'lightlike';

/** The invariant interval (c t)² - x² from the origin and what kind it is. */
export function interval(t: number, x: number, c: number): { s2: number; kind: IntervalKind } {
  const ct = c * t;
  const s2 = (ct - x) * (ct + x);
  const scale = Math.max(ct * ct, x * x);
  const kind = Math.abs(s2) <= 1e-12 * scale ? 'lightlike' : s2 > 0 ? 'timelike' : 'spacelike';
  return { s2, kind };
}

/** Relativistic velocity addition in units of c: w = (u + v) / (1 + u v). */
export function addVelocities(u: number, v: number): number {
  if (!(Math.abs(u) <= 1)) fail('kitPhysics.relativity.errors.speed');
  if (!(Math.abs(v) < 1)) fail('kitPhysics.relativity.errors.lightFrame');
  return (u + v) / (1 + u * v);
}

export interface Particle {
  gamma: number;
  beta: number;
  /** Rest energy m c², total energy, kinetic energy, and p c, all in joules. */
  rest: number;
  total: number;
  kinetic: number;
  pc: number;
}

export type ParticleGiven = { ke: number } | { beta: number } | { pc: number };

/** A particle of rest energy m c² from its kinetic energy, its speed, or its momentum (as p c). */
export function particle(rest: number, given: ParticleGiven): Particle {
  if (!(rest > 0)) fail('kitPhysics.relativity.errors.mass');
  let gamma: number;
  let gm1: number;
  if ('ke' in given) {
    gm1 = given.ke / rest;
    gamma = 1 + gm1;
  } else if ('beta' in given) {
    gamma = lorentzFactor(given.beta);
    gm1 = gammaMinusOne(given.beta);
  } else {
    const ratio = given.pc / rest;
    gamma = Math.hypot(1, ratio);
    gm1 = (ratio * ratio) / (gamma + 1);
  }
  const gammaBeta = Math.sqrt(gm1 * (gamma + 1));
  return {
    gamma,
    beta: gammaBeta / gamma,
    rest,
    total: gamma * rest,
    kinetic: gm1 * rest,
    pc: gammaBeta * rest,
  };
}

/**
 * The relativistic Doppler factor f / f0 for a source moving along the line of sight: sqrt((1 - beta) / (1 + beta))
 * when it moves away, and the inverse when it comes closer.
 */
export function dopplerFactor(beta: number, receding: boolean): number {
  checkBeta(beta);
  const away = Math.sqrt((1 - beta) / (1 + beta));
  return receding ? away : 1 / away;
}
