// The code block's Copy and language buttons in a real page: they sit in a row of their own above the code, so
// they never cover its first line, and they use the small text size (walk 9 VA-8).
import { afterEach, expect, it } from 'vitest';
import { cleanupPages, renderPage } from '../test/harness';
import { textPageFixture } from '../test/fixtures';

const TEXT = '01k6f0000000000000000t0001';

afterEach(async () => {
  await cleanupPages();
});

it('keeps the buttons off the first line of code and uses the small text size', async () => {
  const line = 'const answer = computeTheAnswerToEverything(alpha, beta, gamma, delta, epsilon, zeta, eta);';
  const page = await renderPage({ fixture: textPageFixture('```javascript\n' + line + '\nreturn answer;\n```') });
  page.mounted.pool.mount(TEXT, { kind: 'end' }, 'target');
  const root = page.editRoot(TEXT);
  await expect.poll(() => root.querySelectorAll('pre button').length).toBe(2);
  const buttons = [...root.querySelectorAll<HTMLElement>('pre button')];
  const code = root.querySelector('pre code') as HTMLElement;
  const first = code.getClientRects()[0];
  for (const button of buttons) {
    const box = button.getBoundingClientRect();
    expect(box.bottom).toBeLessThanOrEqual(first.top + 1);
    expect(Number.parseFloat(getComputedStyle(button).fontSize)).toBeGreaterThanOrEqual(13);
  }
});
