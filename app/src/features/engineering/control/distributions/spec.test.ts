// The distributions tool through the window's path: the answers it reports for the plan's cases.
import '../text';
import { describe, expect, it } from 'vitest';
import { runTool } from '../ui/read';
import { firstTexts } from '../ui/spec';
import { spec } from './spec';

const rows = (texts: Record<string, string>) => {
  const r = runTool(spec, { ...firstTexts(spec), ...texts }, 'si');
  if (!r.ok) throw new Error(JSON.stringify(r));
  return Object.fromEntries(r.outcome.rows.map((row) => [row.id, String(row.value)]));
};
const near = (text: string, value: number, tol: number) => expect(Math.abs(Number(text) - value)).toBeLessThan(tol);

describe('the distributions tool', () => {
  it('gives Poisson P(X ≤ 2) = 0.42319 and binomial P(X = 2) = 0.23347', () => {
    near(rows({ dist: 'poisson', lambda: '3', region: 'le', a: '2' }).probability, 0.42319, 5e-6);
    near(rows({ dist: 'binomial', n: '10', p: '0.3', region: 'eq', a: '2' }).probability, 0.23347, 5e-6);
  });

  it('gives the t interval half-width 0.71536 and the variance interval (0.47312, 3.33285)', () => {
    const t = rows({ mode: 'interval', target: 'mean', size: '10', avg: '5', sdev: '1', conf: '95' });
    near(t.halfWidth, 0.71536, 5e-6);
    near(t.critical, 2.26216, 5e-6);
    const v = rows({ mode: 'interval', target: 'variance', size: '10', sdev: '1', conf: '95' });
    expect(v.interval).toBe('(0.473117, 3.33285)');
  });

  it('gives the Welch test t = −1.98354, df = 18.387, p = 0.06244', () => {
    const w = rows({
      mode: 'test',
      test: 'twoMeans',
      size: '15',
      avg: '10',
      sdev: '2',
      secondsize: '12',
      secondavg: '12',
      secondsdev: '3',
    });
    near(w.statistic.replace('−', '-'), -1.98354, 5e-6);
    near(w.df, 18.387, 5e-4);
    near(w.pValue, 0.06244, 5e-6);
    expect(w.decision).toBe('✗');
  });

  it('marks the parameter that is out of range, and refuses a point of a continuous distribution', () => {
    const bad = runTool(spec, { ...firstTexts(spec), dist: 'normal', sd: '-1' }, 'si');
    expect(!bad.ok && bad.fields[0]).toMatchObject({
      field: 'sd',
      problem: { key: 'kitControl.errors.paramPositive' },
    });
    const point = runTool(spec, { ...firstTexts(spec), dist: 'normal', region: 'eq' }, 'si');
    expect(!point.ok && point.fields[0].field).toBe('region');
    const conf = runTool(spec, { ...firstTexts(spec), mode: 'interval', conf: '120' }, 'si');
    expect(!conf.ok && conf.fields[0].field).toBe('conf');
  });
});

describe('moments that diverge or are undefined', () => {
  const run = (texts: Record<string, string>): Record<string, string> => {
    const r = runTool(spec, { ...firstTexts(spec), region: 'le', a: '1', ...texts }, 'si');
    if (!r.ok) throw new Error(JSON.stringify(r));
    const row: Record<string, string> = Object.fromEntries(r.outcome.rows.map((x) => [x.id, String(x.value)]));
    return { ...row, notes: (r.outcome.notes ?? []).map((n) => n.id).join(',') };
  };

  it('F(1, 1): mean ∞, variance undefined; F(12, 3): variance ∞', () => {
    const a = run({ dist: 'f', df1: '1', df2: '1' });
    expect(a.mean).toBe('∞');
    expect(a.variance).toBe('—');
    expect(a.notes).toBe('momentUndefined,momentInfinite');
    const b = run({ dist: 'f', df1: '12', df2: '3' });
    expect(b.mean).toBe('3');
    expect(b.variance).toBe('∞');
  });

  it('t(1) has an undefined mean, t(1.5) an infinite variance, and no row shows NaN', () => {
    const a = run({ dist: 't', df: '1' });
    expect(a.mean).toBe('—');
    expect(a.notes).toContain('momentUndefined');
    const b = run({ dist: 't', df: '1.5' });
    expect(b.variance).toBe('∞');
    for (const v of [...Object.values(a), ...Object.values(b)]) expect(v).not.toContain('NaN');
  });
});
