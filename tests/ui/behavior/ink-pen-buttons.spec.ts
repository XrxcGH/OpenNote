// The pen's own buttons on the web platform: the eraser end erases whole strokes and the barrel button lassos,
// whatever tool the Draw tab has chosen. Playwright's mouse can't be a pen, so the test sends pen pointer events.
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { choose, draw, heldStrokes, line, openPage } from '../ink';
import type { Point } from '../ink';

/** A pen gesture with the given buttons held: 32 is the eraser end, 2 the barrel button. */
async function penGesture(page: Page, points: readonly Point[], buttons: number): Promise<void> {
  await page.evaluate(
    ({ points, buttons }) => {
      const box = document.querySelector('[data-ink-overlay]')!.getBoundingClientRect();
      const [x0, y0] = points[0];
      const target = document.elementFromPoint(box.x + x0, box.y + y0)!;
      const send = (type: string, [x, y]: readonly number[], held: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 41,
            pointerType: 'pen',
            isPrimary: true,
            clientX: box.x + x,
            clientY: box.y + y,
            button: type === 'pointermove' ? -1 : buttons === 32 ? 5 : 2,
            buttons: held,
            pressure: held ? 0.5 : 0,
          }),
        );
      send('pointerdown', points[0], buttons);
      for (const point of points.slice(1)) send('pointermove', point, buttons);
      send('pointerup', points[points.length - 1], 0);
    },
    { points, buttons },
  );
}

test('erases with the eraser end and lassos with the barrel button while the pen tool is on', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Ink, 0.5 mm');
  await draw(page, line([100, 300], [400, 300]));
  await draw(page, line([100, 420], [400, 420]));
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(2);
  await penGesture(page, line([250, 270], [250, 330]), 32);
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(1);
  const loop: Point[] = Array.from({ length: 33 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    return [250 + 200 * Math.cos(a), 420 + 60 * Math.sin(a)];
  });
  await penGesture(page, loop, 2);
  await expect(page.getByRole('group', { name: 'Selected ink and text' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pen, Ink, 0.5 mm' })).toHaveAttribute('aria-pressed', 'true');
});
