import { describe, expect, it } from 'vitest';
import { kitPhysics } from './kitPhysics';

// Field labels are names only: the form adds the single "(optional)" suffix from kitPhysics.ui.optional when a field
// is optional, so a label that says so itself would show it twice.
describe('physics kit field labels', () => {
  it('never say "(optional" themselves', () => {
    const offenders: string[] = [];
    for (const [tool, group] of Object.entries(kitPhysics)) {
      const labels = (group as { f?: Record<string, unknown> }).f;
      if (!labels || typeof labels !== 'object') continue;
      for (const [key, label] of Object.entries(labels)) {
        if (typeof label === 'string' && label.includes('(optional')) offenders.push(`${tool}.f.${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
