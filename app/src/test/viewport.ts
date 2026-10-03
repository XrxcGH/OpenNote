// Resizing the test window (the `components` project, in a real browser).

import { expect } from 'vitest';
import { page } from 'vitest/browser';

const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

/**
 * Resizes the window and waits until the page has seen it. page.viewport returns once the new size is set, but
 * the window's resize event arrives with a later frame. A test that mounts the app straight afterwards would then
 * get a resize event it didn't ask for, and the app would measure its size class again and drop the one the test
 * chose with renderApp. Two frames are enough for the event to have gone by.
 */
export async function setViewport(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  await expect.poll(() => window.innerWidth).toBe(width);
  await nextFrame();
  await nextFrame();
}
