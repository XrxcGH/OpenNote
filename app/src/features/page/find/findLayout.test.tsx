// The Find and Replace bar at narrow widths and large text: no control is drawn over another (walk 9 VA-1, VA-2).
import { screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { renderUi } from '../../../test';
import { closeFind, openFind } from '../qol/stores';
import { cleanupPages, renderPage } from '../test/harness';
import { textPageFixture } from '../test/fixtures';
import { FindBar } from './FindBar';

afterEach(async () => {
  closeFind();
  document.documentElement.style.fontSize = '';
  await cleanupPages();
});

/** The area two boxes share, in square pixels. */
function overlap(a: DOMRect, b: DOMRect): number {
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return x > 0 && y > 0 ? x * y : 0;
}

/** Each pair of the bar's controls that overlap, by their accessible text. */
function collisions(bar: HTMLElement): string[] {
  const controls = [...bar.querySelectorAll<HTMLElement>('input, button, [role="switch"]')].filter(
    (element) => element.getBoundingClientRect().width > 0,
  );
  const found: string[] = [];
  controls.forEach((a, index) => {
    for (const b of controls.slice(index + 1)) {
      if (a.contains(b) || b.contains(a)) continue;
      const area = overlap(a.getBoundingClientRect(), b.getBoundingClientRect());
      if (area > 0.5)
        found.push(`${a.textContent || a.getAttribute('aria-label') || a.tagName} x ${b.textContent || b.tagName}`);
    }
  });
  return found;
}

async function renderBar(width: number) {
  const page = await renderPage({ fixture: textPageFixture('First line.'), flags: { 'page.findReplace': true } });
  renderUi(
    <div style={{ inlineSize: `${width}px` }}>
      <FindBar mounted={page.mounted} />
    </div>,
  );
  openFind(true);
  return screen.findByRole('search');
}

it.each([
  ['600 px', 600, ''],
  ['900 px', 900, ''],
  ['460 px', 460, ''],
  ['320 px', 320, ''],
  ['600 px at 200% text', 600, '200%'],
])('draws no control over another at %s', async (_name, width, fontSize) => {
  document.documentElement.style.fontSize = fontSize;
  const bar = await renderBar(width);
  expect(collisions(bar)).toEqual([]);
  // Nothing runs past the bar's own edge either.
  const edge = bar.getBoundingClientRect().right;
  for (const control of bar.querySelectorAll('input, button')) {
    expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(edge + 1);
  }
});

it('keeps the bar short at a wide window, with Close beside the find buttons', async () => {
  const bar = await renderBar(900);
  expect(bar.getBoundingClientRect().height).toBeLessThanOrEqual(195);
  const close = screen.getByRole('button', { name: 'Close' });
  const next = screen.getByRole('button', { name: 'Find next' });
  expect(Math.abs(close.getBoundingClientRect().top - next.getBoundingClientRect().top)).toBeLessThan(2);
});
