// The kit windows' layout is measured in the browser (tests/ui/behavior/kit-layout.spec.ts). What jsdom can check:
// no thermodynamics subject has the name of one of its tabs, so the tab strip never reads the same word twice.
import { describe, expect, it } from 'vitest';
import { kitThermo } from '../../../../strings/en/kitThermo';

describe('kit labels', () => {
  it('gives no thermodynamics subject the name of one of its tabs', () => {
    const tabs = Object.values(kitThermo.tab);
    for (const name of Object.values(kitThermo.subject)) expect(tabs).not.toContain(name);
  });
});
