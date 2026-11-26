// The frequency response tool through the window's path: the plan's answers as shown, Hz display, and problems.
import '../text';
import { describe, expect, it } from 'vitest';
import { runTool } from '../ui/read';
import { firstTexts } from '../ui/spec';
import { spec } from './spec';

const run = (texts: Record<string, string>) => runTool(spec, { ...firstTexts(spec), ...texts }, 'si');
const rows = (texts: Record<string, string>) => {
  const r = run(texts);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return Object.fromEntries(r.outcome.rows.map((row) => [row.id, String(row.value)]));
};
const problem = (texts: Record<string, string>) => {
  const r = run(texts);
  if (r.ok) throw new Error('expected a problem');
  return r.fields.map((f) => `${f.field}: ${f.problem.key.split('.').pop()}`).join('; ') || r.error?.key;
};

describe('the frequency response tool', () => {
  it('shows the margins of 10/(s(s + 1)(s + 5))', () => {
    const r = rows({});
    expect(r.wgc).toBe('1.22706 rad/s');
    expect(r.pm).toBe('25.3898°');
    expect(r.wpc).toBe('2.23607 rad/s');
    expect(r.gm).toBe('9.54243 dB');
  });

  it('shows frequencies in Hz when asked', () => {
    expect(rows({ hz: 'hz' }).wpc).toBe(`${(Math.sqrt(5) / (2 * Math.PI)).toPrecision(6)} Hz`);
  });

  it('evaluates 1/(s + 1) at 1 rad/s', () => {
    const r = rows({ g: '1/(s + 1)', at: '1' });
    expect(r.magAt).toBe('−3.0103 dB');
    expect(r.phaseAt).toBe('−45°');
  });

  it('judges the unstable open loop 2(s + 1)/(s(s − 1)) stable when closed', () => {
    const r = rows({ mode: 'nyquist', g: '2 (s + 1)/(s (s - 1))' });
    expect([r.p, r.ccw, r.z, r.stable]).toEqual(['1', '1', '0', '✓']);
  });

  it('marks impossible input on its field', () => {
    expect(problem({ g: 's^2/(s + 1)' })).toBe('g: improper');
    expect(problem({ delay: '-1' })).toBe('delay: delayRange');
    expect(problem({ wMin: '10', wMax: '1' })).toBe('wMax: rangeOrder');
    expect(problem({ mode: 'nyquist', g: '(s + 2)/(s + 1)', delay: '0.1' })).toBe('delay: delayProper');
  });
});
