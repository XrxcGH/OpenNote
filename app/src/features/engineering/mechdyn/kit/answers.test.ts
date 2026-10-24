// The answers each tool shows, read from the form the way a student types it. These are the plan's validation
// cases, run through the units, the spec, and the row text, so a slip between engine and window shows up here.
/* eslint-disable opennote/feature-boundaries -- The tests hand the engines the math feature's algebra directly. */
import { describe, expect, it } from 'vitest';
import { t } from '../../../../strings/t';
import { SPECS } from '../specs';
import { rowText, type Say } from '../ui/insert';
import { firstTexts, runTool } from './read';
import type { System } from './units';
import { simplest, substitute } from '../../../math/calculus/algebra';
import { derivativeOf } from '../../../math/calculus/derivative';
import { latexOf } from '../../../math/calculus/print';
import { provideSymbolic } from '../symbolic';

provideSymbolic({ derivativeOf, latexOf, simplest, substitute });

const say = t as unknown as Say;

interface Case {
  readonly name: string;
  readonly tool: string;
  readonly texts: Readonly<Record<string, string>>;
  readonly system?: System;
  /** Row id (with its vars' first value after a colon when rows repeat) and the text it shows. */
  readonly expect: Readonly<Record<string, string>>;
}

const CASES: readonly Case[] = [
  {
    name: 'free vibration: natural frequency, damping, and decrement',
    tool: 'sdof',
    texts: { m: '10 kg', k: '4000 N/m', c: '40 N*s/m' },
    expect: { omegaN: '20 rad/s', zeta: '0.1', omegaD: '19.9 rad/s', logDec: '0.63148', regime: 'Underdamped' },
  },
  {
    name: 'a harmonic force: steady amplitude and phase',
    tool: 'sdof',
    texts: { forcing: 'harmonic', F0: '100 N', omega: '15 rad/s' },
    expect: { X: '54.054 mm', phase: '18.925°' },
  },
  {
    name: 'base motion at r = 2: transmissibility',
    tool: 'sdof',
    texts: { damping: 'zeta', zeta: '0.1', forcing: 'base', omega: '40 rad/s' },
    expect: { r: '2', transmissibility: '0.35586' },
  },
  {
    name: 'the isolation example: x lags y by 150.604°, z = x - y by 172.405°',
    tool: 'sdof',
    texts: { damping: 'zeta', zeta: '0.1', forcing: 'base', x0: '0 mm', omega: '40 rad/s' },
    expect: { phase: '150.6°', relativePhase: '172.41°' },
  },
  {
    name: 'the isolation example in US units',
    tool: 'sdof',
    system: 'us',
    texts: { damping: 'zeta', zeta: '0.1', forcing: 'base', x0: '0 in', omega: '40 rad/s' },
    expect: { phase: '150.6°', relativePhase: '172.41°' },
  },
  {
    name: 'the same mass and spring in US units',
    tool: 'sdof',
    system: 'us',
    texts: { m: '22.046226 lb', k: '22.840589 lbf/in', c: '0.22840589 lbf*s/in' },
    expect: { omegaN: '20 rad/s', zeta: '0.1' },
  },
  {
    name: 'a cantilever at PL²/EI = 2: elastica and pseudo-rigid-body model',
    tool: 'compliant',
    texts: { force: '0.56 N' },
    expect: {
      loadIndex: '2',
      exactAL: '0.83936',
      exactBL: '0.49346',
      exactTheta: '44.791°',
      prbmAL: '0.84377',
      prbmBL: '0.49111',
      Theta: '35.294°',
    },
  },
  {
    name: 'the same flexure typed in inches and pounds',
    tool: 'compliant',
    system: 'us',
    texts: {
      length: '1.9685039 in',
      width: '0.23622047 in',
      thickness: '0.039370079 in',
      E: '203.05283 ksi',
      force: '0.12589301 lbf',
    },
    expect: { exactAL: '0.83936', Theta: '35.294°' },
  },
  {
    name: 'a spur pair: center distance, base radius, and contact ratio',
    tool: 'gears',
    texts: { mode: 'pair', module: '2 mm', N1: '20', N2: '40', phi: '20' },
    expect: { center: '60 mm', rb1: '18.794 mm', contactRatio: '1.6352', interference: 'No' },
  },
  {
    name: 'the fewest pinion teeth meshing with an equal gear',
    tool: 'gears',
    texts: { mode: 'pair', N1: '12', N2: '12' },
    expect: { minTeeth: '12.323', minTeethWhole: '13', interference: 'Yes' },
  },
  {
    name: 'the same pair sized by diametral pitch',
    tool: 'gears',
    system: 'us',
    texts: { mode: 'pair', sizing: 'diametral', pitch: '12.7', N1: '20', N2: '40' },
    expect: { center: '2.3622 in', contactRatio: '1.6352' },
  },
  {
    name: 'a planetary train with the ring held',
    tool: 'gears',
    texts: { mode: 'planetary', sun: '30', ring: '90', fixed: 'ring', inputMember: 'sun', outputMember: 'carrier' },
    expect: { planetRatio: '4', outputSpeed: '250 rpm', spacing: 'Yes' },
  },
  {
    name: 'a compound train of two external meshes',
    tool: 'gears',
    texts: { mode: 'train', stages: '20 60\n15 45', inputSpeed: '900 rpm' },
    expect: { value: '0.11111', outputSpeed: '100 rpm' },
  },
  {
    name: 'a cycloidal rise of 25 mm over 90°: peaks per radian',
    tool: 'cam',
    texts: { program: 'rise 90 25 cycloidal\ndwell 90\nreturn 90 25 cycloidal\ndwell 90' },
    expect: { vPerRad: '31.831 mm', aPerRad: '63.662 mm', lift: '25 mm', undercut: 'No' },
  },
  {
    name: 'the same rise with simple harmonic motion',
    tool: 'cam',
    texts: { program: 'rise 90 25 harmonic\ndwell 90\nreturn 90 25 harmonic\ndwell 90' },
    expect: { vPerRad: '25 mm', aPerRad: '50 mm' },
  },
  {
    name: 'the same rise with the 3-4-5 polynomial',
    tool: 'cam',
    texts: { program: 'rise 90 25 poly345\ndwell 90\nreturn 90 25 poly345\ndwell 90' },
    expect: { vPerRad: '29.842 mm' },
  },
  {
    name: 'a cycloidal rise of 1 inch in US units',
    tool: 'cam',
    system: 'us',
    texts: {
      program: 'rise 90 1 cycloidal\ndwell 90\nreturn 90 1 cycloidal\ndwell 90',
      baseRadius: '2 in',
      rollerRadius: '0.5 in',
    },
    expect: { lift: '1 in', vPerRad: '1.2732 in' },
  },
  {
    name: 'a planar two-link arm: end point, det J, and both elbows',
    tool: 'robotkin',
    texts: {},
    expect: { x: '1.1248 m', y: '1.4659 m', detJ: '0.70711', solutions: '2', method: 'Closed form, two links' },
  },
  {
    name: 'a spatial three-joint arm in standard form',
    tool: 'robotkin',
    texts: { table: 'R 0 90 0.5 30\nR 1 0 0 45\nR 1 0 0 -60', x: '1 m', y: '0.5 m', z: '1 m' },
    expect: { x: '1.4489 m', y: '0.83652 m', z: '0.94829 m', method: 'Numerical (damped least squares)' },
  },
  {
    name: 'link lengths typed in feet',
    tool: 'robotkin',
    system: 'us',
    texts: { x: '1.5 ft', y: '0.5 ft' },
    expect: { x: '1.1248 ft', y: '1.4659 ft', solutions: '2' },
  },
  {
    name: 'two masses between walls: both natural frequencies',
    tool: 'mdof',
    texts: {},
    expect: { 'omega:1': '1 rad/s', 'omega:2': '1.7321 rad/s' },
  },
  {
    name: 'three masses, fixed and free',
    tool: 'mdof',
    texts: { masses: '1 1 1', springs: '1 1 1 0', x0: '10 0 0' },
    expect: { 'omega:1': '0.44504 rad/s', 'omega:2': '1.247 rad/s', 'omega:3': '1.8019 rad/s' },
  },
  {
    name: 'the same two masses in US units',
    tool: 'mdof',
    system: 'us',
    texts: { masses: '2.2046226 2.2046226', springs: '0.0057101471 0.0057101471 0.0057101471', x0: '0.4 0' },
    expect: { 'omega:1': '1 rad/s', 'omega:2': '1.7321 rad/s' },
  },
  {
    name: 'a steel cantilever: first bending frequency',
    tool: 'mdof',
    texts: { model: 'member' },
    expect: { 'f:1': '28.246 Hz' },
  },
  {
    name: 'a crank-rocker at 30°: Grashof class, angles, and rates',
    tool: 'linkage',
    texts: {},
    expect: {
      grashof: 'Crank-rocker',
      theta3: '88.837°',
      theta4: '117.29°',
      transmission: '28.449°',
      omega3: '−5.991 rad/s',
      omega4: '−3.9917 rad/s',
      alpha3: '26.08 rad/s²',
      alpha4: '53.331 rad/s²',
    },
  },
  {
    name: 'a slider-crank at 60°: slider position, velocity, and acceleration',
    tool: 'linkage',
    texts: { type: 'slider', a: '50 mm', b: '150 mm', e: '0 mm', theta2: '60', omega2: '100 rad/s' },
    expect: { x: '168.61 mm', v: '−5.0839 m/s', a: '−166.92 m/s²' },
  },
  {
    name: 'the same slider-crank in inches',
    tool: 'linkage',
    system: 'us',
    texts: { type: 'slider', a: '50 mm', b: '150 mm', e: '0 in', theta2: '60', omega2: '100 rad/s' },
    expect: { x: '6.6383 in', a: '−547.63 ft/s²' },
  },
  {
    name: 'a pendulum released from 90°: small-oscillation frequency and period ratio',
    tool: 'lagrange',
    texts: {},
    expect: { 'omega:1': '3.1321 rad/s', periodRatio: '1.1803', equilibria: '2' },
  },
  {
    name: 'a thin plate about its corner: tensor and principal moments',
    tool: 'rigid3d',
    texts: {},
    expect: {
      Ixx: '0.026667 kg·m²',
      Iyy: '0.10667 kg·m²',
      Izz: '0.13333 kg·m²',
      Ixy: '−0.04 kg·m²',
      'principal:1': '0.010098 kg·m²',
      'principal:2': '0.12324 kg·m²',
      'principal:3': '0.13333 kg·m²',
    },
  },
  {
    name: 'the same plate in pounds and feet',
    tool: 'rigid3d',
    system: 'us',
    texts: { bodies: 'plate 4.4092452 1.312336 0.65616798 0.65616798 0.32808399 0' },
    expect: { 'principal:3': '3.164 lb·ft²' },
  },
  {
    name: 'torque-free precession of an axisymmetric body',
    tool: 'rigid3d',
    texts: { task: 'tensor' },
    expect: { bodyRate: '10 rad/s' },
  },
  {
    name: 'Euler angles 30°, 20°, 10° as a quaternion and an axis-angle',
    tool: 'rigid3d',
    texts: { task: 'rotation' },
    expect: { qw: '0.95155', qx: '0.038135', qy: '0.18931', qz: '0.2393', angle: '35.817°' },
  },
];

describe('the answers the window shows', () => {
  for (const one of CASES) {
    it(`${one.tool}: ${one.name}`, async () => {
      const spec = await SPECS[one.tool]();
      const system = one.system ?? 'si';
      const run = runTool(spec, { ...firstTexts(spec), ...one.texts }, system);
      if (!run.ok) throw new Error(run.error?.key ?? run.fields.map((f) => `${f.field} ${f.error.key}`).join());
      const c = { tool: one.tool, outcome: run.outcome, system, say };
      for (const [key, text] of Object.entries(one.expect)) {
        const [id, first] = key.split(':');
        const row = run.outcome.rows.find(
          (r) => r.id === id && (first === undefined || Object.values(r.vars ?? {})[0] === first),
        );
        expect(row, key).toBeDefined();
        if (row) expect(rowText(c, row), key).toBe(text);
      }
    }, 30_000);
  }
});
