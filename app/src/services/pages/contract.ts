// The page service contract suite (ARCHITECTURE.md section 10.1; owner: WP2). Every PageService runs it: the
// memory service in Vitest, and the Tauri adapter against the real core in tests/e2e/page/page.contract.spec.ts,
// which runs the same cases from contractCases.ts. Import this file only from tests.
//
// `make` must return a fresh service that holds CONTRACT_PAGE, and may hold other pages.
import { describe, it } from 'vitest';
import { CONTRACT_CASES } from './contractCases';
import type { PageService } from './types';

export { CONTRACT_CASES, CONTRACT_PAGE } from './contractCases';

export function describePageService(name: string, make: () => Promise<PageService>): void {
  describe(`${name}: the page service contract`, () => {
    for (const contractCase of CONTRACT_CASES) it(contractCase.name, () => contractCase.run(make));
  });
}
