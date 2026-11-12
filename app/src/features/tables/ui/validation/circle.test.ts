import { describe, expect, it } from 'vitest';
import { circleAttributes } from './circle';

describe('circleAttributes', () => {
  it('says the value is not valid once, without the refusal that applies to typed text', () => {
    const attrs = circleAttributes({
      row: 0,
      col: 0,
      verdict: { ok: false, ruleId: 'v1', alert: 'stop', reason: 'range', message: null },
    });
    expect(attrs.title).toBe('Not valid: That value is outside the allowed range.');
    expect(attrs.title).not.toContain('keeps its old value');
  });
});
