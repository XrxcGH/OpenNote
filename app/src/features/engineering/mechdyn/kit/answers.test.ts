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
