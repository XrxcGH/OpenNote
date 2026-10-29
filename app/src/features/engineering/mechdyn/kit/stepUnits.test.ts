import { describe, expect, it } from 'vitest';
import { SPECS } from '../specs';
import { cellText } from './format';
import { firstTexts, runTool } from './read';
import { stepMath } from './stepUnits';

describe('worked steps in US units', () => {
  it('keeps SI steps as they are', () => {
    expect(stepMath(String.raw`X = 0.054054\ \mathrm{m}`, 'si')).toBe(String.raw`X = 0.054054\ \mathrm{m}`);
  });

  it('adds the US value after each SI quantity, by hand', () => {
    // 0.0254 m is 1 in; 4.4482216 N is 1 lbf; 1.2 x 10^-3 m is 0.047244 in; 3.048 m is 10 ft; rad/s stays.
    const us = stepMath(
      String.raw`a = 0.0254\ \mathrm{m},\ F = 4.4482216\ \mathrm{N},\ d = 1.2 \times 10^{-3}\ \mathrm{m},\ \omega = 20\ \mathrm{rad/s}`,
      'us',
    );
    expect(us).toContain(String.raw`0.0254\ \mathrm{m}\ (1\,\mathrm{in})`);
    expect(us).toContain(String.raw`\ (1\,\mathrm{lbf})`);
    expect(us).toContain(String.raw`\ (0.047244\,\mathrm{in})`);
    expect(us).toContain(String.raw`\omega = 20\ \mathrm{rad/s}`);
    expect(stepMath(String.raw`L = 3.048\ \mathrm{m}`, 'us')).toContain(String.raw`(10\,\mathrm{ft})`);
    expect(us.endsWith(String.raw`20\ \mathrm{rad/s}`)).toBe(true);
  });

  it('shows the steady amplitude in a step as the US results table shows it', async () => {
    const spec = await SPECS.sdof();
    const run = runTool(spec, { ...firstTexts(spec), forcing: 'harmonic', F0: '22.480894 lbf' }, 'us');
    if (!run.ok) throw new Error('the harmonic case did not run');
    const row = run.outcome.rows.find((r) => r.id === 'X')!;
    const table = cellText(row.value!, 'us');
    expect(table).toBe('2.1281 in');
    const step = run.outcome.steps.find((s) => s.key === 'sdofAmplitude')!;
    expect(stepMath(step.math!, 'us', run.outcome.rows.map((r) => r.value))).toContain(String.raw`(2.1281\,\mathrm{in})`);
  });
});
