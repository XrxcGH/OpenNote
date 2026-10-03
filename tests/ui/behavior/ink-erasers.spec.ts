// The stroke eraser and the partial eraser on the web platform: one removes whole strokes it touches, the other cuts
// them, and each gesture is one undo step.
import { expect, test } from '../fixtures';
import { choose, draw, heldStrokes, line, openPage, undo } from '../ink';

test('erases whole strokes with the stroke eraser, and undo brings them back', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Ink, 0.5 mm');
  await draw(page, line([100, 300], [400, 300]));
  await draw(page, line([100, 400], [400, 400]));
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(2);
  await choose(page, 'Stroke eraser');
  await draw(page, line([250, 270], [250, 330]));
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(1);
  await expect(page.getByText('Erased 1 stroke')).toBeAttached();
  await undo(page);
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(2);
});

test('cuts a stroke in two with the partial eraser', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Ink, 0.5 mm');
  await draw(page, line([100, 350], [500, 350], 40));
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(1);
  await choose(page, 'Partial eraser');
  await draw(page, line([300, 320], [300, 380]));
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(2);
  await undo(page);
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(1);
});
