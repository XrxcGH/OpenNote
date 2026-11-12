// Lockdown parity with the code cells' sandbox: every name the code cells' lockdown probe checks is on the run
// lockdown's FORBIDDEN list, and no allowance can keep one. run.test.tsx checks the same in a real worker.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALLOWANCES } from './adapters';
import { FORBIDDEN, keptNames } from './lockdown';

const probe = readFileSync(new URL('../../codecells/sandbox/lockdownProbe.ts', import.meta.url), 'utf8');
const NAMES = [.../const NAMES = \[([^\]]*)\]/.exec(probe)![1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);

describe('lockdown parity', () => {
  it('forbids every name in the code cells’ lockdown probe', () => {
    expect(NAMES.length).toBeGreaterThan(30);
    expect(NAMES.filter((name) => !(FORBIDDEN as readonly string[]).includes(name))).toEqual([]);
  });

  it('keeps no forbidden name, whatever an adapter allows', () => {
    for (const allowances of [...Object.values(ALLOWANCES), FORBIDDEN]) {
      const kept = keptNames(['Module'], allowances);
      expect(FORBIDDEN.filter((name) => kept.has(name))).toEqual([]);
      const allowed = allowances.filter((name) => !(FORBIDDEN as readonly string[]).includes(name));
      expect(allowed.filter((name) => !kept.has(name))).toEqual([]);
    }
  });
});
