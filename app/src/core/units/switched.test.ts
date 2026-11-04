import { beforeEach, describe, expect, it } from 'vitest';
import { forgetSwitched, roundedText, switchedText } from './switched';

const IN = 25.4; // mm per inch, exact by definition

beforeEach(forgetSwitched);

describe('the number a field shows after a unit switch', () => {
  it('is rounded to six figures so it reads well', () => {
    // 20 mm / 25.4 = 0.787401574803... in
    expect(switchedText('20', 'mm', 'in', 20 / IN)).toBe('0.787402');
    expect(roundedText(328.083989501312)).toBe('328.084');
  });

  it('returns exactly what the field said when switched straight back', () => {
    const us = switchedText('20', 'mm', 'in', 20 / IN);
    // Converting 0.787402 in back would give 20.0000508 mm; the field must say 20 again.
    expect(switchedText(us, 'in', 'mm', Number(us) * IN)).toBe('20');
    const speed = switchedText('100', 'm/min', 'ft/min', 100 / 0.3048);
    expect(switchedText(speed, 'ft/min', 'm/min', Number(speed) * 0.3048)).toBe('100');
  });

  it('keeps a number the person typed after the switch (no false restore)', () => {
    switchedText('20', 'mm', 'in', 20 / IN);
    expect(switchedText('1', 'in', 'mm', 1 * IN)).toBe('25.4');
  });

  it('does not restore across another unit', () => {
    const us = switchedText('20', 'mm', 'in', 20 / IN);
    expect(switchedText(us, 'in', 'cm', Number(us) * 2.54)).toBe('2');
  });
});
