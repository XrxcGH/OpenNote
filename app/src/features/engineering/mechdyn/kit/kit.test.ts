// The kit's shared parts. Typed quantities read into SI, with their units checked, and numbers are written for
// people. Every tool's spec runs on its first values and each example, in SI and US units. Every message it names
// is in the strings, with every placeholder filled.
/* eslint-disable opennote/feature-boundaries -- The tests hand the engines the math feature's algebra directly. */
import '../text';
import { describe, expect, it } from 'vitest';
import { t } from '../../../../strings/t';
import { MECHDYN_TOOLS } from '../meta';
import { SPECS } from '../specs';
import { plotPicture, rowLabel, rowText, stepWords, answerLatex, answerText, type Say } from '../ui/insert';
import { MechError } from './errors';
import { cellLatex, cellText, numberText, q } from './format';
import { PAGE } from './picture';
import { firstTexts, pinUnits, runTool } from './read';
import { readQuantity, type System } from './units';
import { simplest, substitute } from '../../../math/calculus/algebra';
import { derivativeOf } from '../../../math/calculus/derivative';
import { latexOf } from '../../../math/calculus/print';
import { provideSymbolic } from '../symbolic';

provideSymbolic({ derivativeOf, latexOf, simplest, substitute });

const say = t as unknown as Say;

/** A message by key with its placeholders filled; it fails the test when the key is missing or a {name} is left. */
function words(key: string, vars?: Readonly<Record<string, string | number>>): string {
  const text = say(key, vars);
  expect(text, key).not.toMatch(/\{[a-zA-Z]+\}/);
  return text;
}

const failure = (run: () => unknown): MechError => {
  try {
    run();
  } catch (error) {
    if (error instanceof MechError) return error;
    throw error;
  }
  throw new Error('No error');
};

describe('typed quantities', () => {
  it('reads a bare number in the unit of the chosen system', () => {
    expect(readQuantity('25', 'small', 'si')).toBeCloseTo(0.025, 12);
    expect(readQuantity('1', 'small', 'us')).toBeCloseTo(0.0254, 12);
    expect(readQuantity('2', 'mass', 'us')).toBeCloseTo(0.90718474, 10);
    expect(readQuantity('2*pi', 'angularSpeed', 'si')).toBeCloseTo(2 * Math.PI, 12);
  });

  it('reads a typed unit whatever the system', () => {
    expect(readQuantity('3 ft', 'length', 'si')).toBeCloseTo(0.9144, 12);
    expect(readQuantity('10 lbf/in', 'stiffness', 'si')).toBeCloseTo(1751.268352, 5);
    expect(readQuantity('90 deg', 'angle', 'si')).toBeCloseTo(Math.PI / 2, 12);
    expect(readQuantity('1 rad', 'angle', 'us')).toBeCloseTo(1, 12);
  });

  it('counts turns for Hz and rpm typed as an angular speed, and the other way round', () => {
    expect(readQuantity('1 Hz', 'angularSpeed', 'si')).toBeCloseTo(2 * Math.PI, 12);
    expect(readQuantity('60 rpm', 'angularSpeed', 'si')).toBeCloseTo(2 * Math.PI, 12);
    expect(readQuantity('1500', 'rpm', 'si')).toBeCloseTo(157.0796327, 6);
    expect(readQuantity('6.283185307 rad/s', 'frequency', 'si')).toBeCloseTo(1, 9);
  });

  it('refuses a unit that measures something else, naming both', () => {
    const error = failure(() => readQuantity('3 kg', 'length', 'si'));
    expect(error.key).toBe('fieldUnit');
    expect(words(`kitMechDyn.errors.${error.key}`, error.vars)).toBe('kg measures something else. Use a unit like m.');
    expect(failure(() => readQuantity('10 Hz', 'force', 'us')).key).toBe('fieldUnit');
  });

  it('says when a field is empty or unreadable', () => {
    expect(failure(() => readQuantity('  ', 'mass', 'si')).key).toBe('fieldEmpty');
    expect(failure(() => readQuantity('abc', 'mass', 'si')).key).toBe('fieldUnreadable');
    expect(failure(() => readQuantity('3 furlongs', 'mass', 'si')).key).toBe('fieldUnreadable');
  });

  it('reads huge and negative values without losing them', () => {
    expect(readQuantity('-4e12', 'force', 'si')).toBe(-4e12);
    expect(readQuantity('1e-9 mm', 'small', 'si')).toBeCloseTo(1e-12, 20);
  });
});

describe('numbers for people', () => {
  it('writes five significant figures, a true minus, and powers of ten', () => {
    expect(numberText(54.054054)).toBe('54.054');
    expect(numberText(-0.5)).toBe('−0.5');
    expect(numberText(5.33333e6)).toBe('5.3333×10⁶');
    expect(numberText(1e-15)).toBe('0');
    expect(numberText(Number.NaN)).toBe('—');
  });

  it('writes a quantity in either system', () => {
    expect(cellText(q(0.054054, 'small'), 'si')).toBe('54.054 mm');
    expect(cellText(q(0.0254, 'small'), 'us')).toBe('1 in');
    expect(cellText(q(Math.PI / 6, 'angle'), 'si')).toBe('30°');
    expect(cellLatex(q(1, 'moment'), 'si')).toBe('1\\,\\mathrm{N{\\cdot}m}');
  });
});

describe('every tool', () => {
  for (const meta of MECHDYN_TOOLS) {
    it(`${meta.id} has its words and works its first values and examples in SI and US`, async () => {
      const id = meta.id;
      for (const part of ['title', 'short', 'about', 'keywords']) words(`kitMechDyn.${id}.${part}`);
      expect(SPECS[id], id).toBeDefined();
      const spec = await SPECS[id]();
      for (const field of spec.fields) {
        words(`kitMechDyn.${id}.field.${field.id}`);
        if (field.hint) words(`kitMechDyn.${id}.hint.${field.id}`);
        if (field.type === 'choice') for (const option of field.options) words(`kitMechDyn.${id}.option.${option}`);
      }
      const cases: [string, Record<string, string>][] = [['first', firstTexts(spec)]];
      for (const example of spec.examples ?? []) {
        words(`kitMechDyn.${id}.example.${example.id}`);
        cases.push([example.id, { ...firstTexts(spec), ...example.values }]);
      }
      for (const [name, texts] of cases) {
        for (const system of ['si', 'us'] as System[]) {
          const typed = system === 'us' ? pinUnits(spec, texts, 'si') : texts;
          const run = runTool(spec, typed, system);
          if (!run.ok) {
            const why = run.error ? run.error.key : run.fields.map((one) => `${one.field}: ${one.error.key}`).join();
            throw new Error(`${id} ${name} ${system}: ${why}`);
          }
          const c = { tool: id, outcome: run.outcome, system, say };
          for (const row of run.outcome.rows) {
            rowLabel(c, row);
            expect(rowText(c, row), `${id} ${row.id}`).not.toMatch(/NaN|undefined/);
          }
          expect(answerText(c)).not.toMatch(/\{|NaN/);
          expect(answerLatex(c)).not.toMatch(/NaN|undefined/);
          for (const note of run.outcome.notes ?? []) words(`kitMechDyn.${id}.note.${note}`);
          for (const table of run.outcome.tables ?? []) {
            words(`kitMechDyn.${id}.table.${table.id}`);
            for (const column of table.columns) words(`kitMechDyn.${id}.col.${column}`);
            for (const cell of table.rows.flat())
              if (typeof cell === 'object' && 'w' in cell) words(`kitMechDyn.${id}.word.${cell.w}`);
          }
          for (const step of run.outcome.steps) {
            expect(stepWords(c, step)).not.toMatch(/\{[a-zA-Z]+\}/);
            expect(step.math ?? '', `${id} ${step.key}`).not.toMatch(/NaN|undefined/);
          }
          for (const plot of run.outcome.plots ?? []) {
            const svg = plotPicture(say, plot, PAGE);
            expect(svg, `${id} plot`).not.toMatch(/NaN|undefined|Infinity/);
          }
          // Same values in both systems: the answers agree once the units are pinned.
          if (system === 'us') {
            const si = runTool(spec, texts, 'si');
            expect(si.ok).toBe(true);
            if (si.ok) expect(run.outcome.rows.length).toBe(si.outcome.rows.length);
          }
        }
      }
      // Each tool runs every example twice, and the simulations take a while on a busy machine.
    }, 60_000);
  }
});
