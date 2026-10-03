// Shape recognition on the web platform: with Ink to shape on, a rough rectangle is stored as an exact one.
import { expect, test } from '../fixtures';
import { choose, draw, heldStrokes, openPage } from '../ink';

test('turns a rough rectangle into an exact one with Ink to shape', async ({ page }) => {
  await openPage(page);
  const toggle = page.getByRole('button', { name: 'Ink to shape' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await choose(page, 'Pen, Ink, 0.5 mm');
  const corners: [number, number][] = [
    [150, 300],
    [452, 303],
    [449, 452],
    [148, 449],
    [151, 302],
  ];
  const path: [number, number][] = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    for (let k = 0; k < 12; k++) {
      const [a, b] = [corners[i], corners[i + 1]];
      path.push([a[0] + ((b[0] - a[0]) * k) / 12 + (k % 2), a[1] + ((b[1] - a[1]) * k) / 12 - (k % 2)]);
    }
  }
  path.push(corners[corners.length - 1]);
  await draw(page, path);
  // An exact rectangle is its four corners and the first again.
  await expect.poll(() => heldStrokes(page)).toEqual([expect.objectContaining({ points: 5 })]);
});
