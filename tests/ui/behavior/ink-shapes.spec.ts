// Shape recognition on the web platform: with Ink to shape on, a rough rectangle is stored as an exact one; with it
// off, the rectangle stays as drawn.
import { expect, test } from '../fixtures';
import { choose, draw, heldStrokes, openPage } from '../ink';
import { press } from '../paperSnap';

// The Draw tab keeps Ink to shape on the bar only when the window is wide; narrower, it sits under More.
test.use({ viewport: { width: 1920, height: 900 } });
// Shapes come from Ink to shape when the pen lifts. Hold to shape is off: the pen events come through the DevTools
// Protocol one at a time, and a busy moment between two of them would read as the pen held still.
test.use({ boot: { settings: { ink: { shapes: { hold: false, inkToShape: true } } } } as never });

function roughRectangle(dx: number): [number, number][] {
  const corners: [number, number][] = [
    [150 + dx, 300],
    [452 + dx, 303],
    [449 + dx, 452],
    [148 + dx, 449],
    [151 + dx, 302],
  ];
  const path: [number, number][] = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    for (let k = 0; k < 12; k++) {
      const [a, b] = [corners[i], corners[i + 1]];
      path.push([a[0] + ((b[0] - a[0]) * k) / 12 + (k % 2), a[1] + ((b[1] - a[1]) * k) / 12 - (k % 2)]);
    }
  }
  path.push(corners[corners.length - 1]);
  return path;
}

test('turns a rough rectangle into an exact one with Ink to shape, and keeps it freehand with it off', async ({
  page,
}) => {
  await openPage(page);
  await press(page, 'Ink to shape', true);
  await choose(page, 'Pen, Ink, 0.5 mm');
  await draw(page, roughRectangle(0));
  // An exact rectangle is its four corners and the first again.
  await expect.poll(() => heldStrokes(page)).toEqual([expect.objectContaining({ points: 5 })]);
  // Off turns every kind of snapping off, so the next rectangle keeps every point the pen drew.
  await press(page, 'Ink to shape', false);
  await draw(page, roughRectangle(400));
  await expect
    .poll(async () => (await heldStrokes(page)).map((s) => s.points > 5).sort())
    .toEqual([false, true]);
});
