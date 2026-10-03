// Runs axe-core on rendered markup (ARCHITECTURE.md section 21.6) and fails with a readable list of violations.

import axe from 'axe-core';
import { expect } from 'vitest';

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Waits for enter and exit transitions, which blend colors: axe would measure a dialog that is half faded in. */
async function settleAnimations(): Promise<void> {
  const finite = document
    .getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY);
  await Promise.allSettled(finite.map((animation) => animation.finished));
}

export async function expectNoAxeViolations(container: Element, options: { tags?: string[] } = {}): Promise<void> {
  await settleAnimations();
  const results = await axe.run(container, { runOnly: { type: 'tag', values: options.tags ?? AXE_TAGS } });
  const violations = results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`,
  );
  expect(violations).toEqual([]);
}
