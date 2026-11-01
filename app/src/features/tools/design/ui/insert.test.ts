import '../text';
import { describe, expect, it } from 'vitest';
import { t } from '../../../../strings/t';
import { stepsHtml } from './insert';
import type { Outcome } from '../kit/spec';
import type { Say } from './insert';

const say = t as unknown as Say;

const outcome: Outcome = { rows: [], steps: [{ key: 'flow', latex: 'F=1' }] };

describe('inserted worked steps', () => {
  it('say they are in the formulas’ own units beside a US answer', () => {
    const us = stepsHtml({ tool: 'forming', outcome, system: 'us', say });
    expect(us).toContain('millimeters, newtons');
    expect(stepsHtml({ tool: 'forming', outcome, system: 'si', say })).not.toContain('millimeters, newtons');
  });
});
