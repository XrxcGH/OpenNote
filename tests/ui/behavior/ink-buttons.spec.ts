// The selection bar's Replay ink and Convert to text answer a finger or a pen: replay opens its bar,
// and Convert asks to turn handwriting on.
import { expect, test } from '../fixtures';
import { choose, draw, ellipse, line, heldStrokes, openPage } from '../ink';
import type { Page } from '@playwright/test';

async function tap(page: Page, kind: 'touch' | 'pen', x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  if (kind === 'touch') {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'pen' } as never);
    const press = { x, y, button: 'left', clickCount: 1, pointerType: 'pen' };
    await cdp.send('Input.dispatchMouseEvent', { ...press, type: 'mousePressed', buttons: 1, force: 0.5 } as never);
    await cdp.send('Input.dispatchMouseEvent', { ...press, type: 'mouseReleased', buttons: 0 } as never);
  }
  await cdp.detach();
}

for (const kind of ['touch', 'pen'] as const) {
  test('Replay ink and Convert to text answer a ' + kind + ' tap', async ({ page }) => {
    await openPage(page);
    await choose(page, 'Pen, Ink, 0.5 mm');
    await draw(page, line([150, 350], [400, 380]));
    await expect.poll(async () => (await heldStrokes(page)).length).toBeGreaterThan(0);
    await choose(page, 'Lasso select');
    await draw(page, ellipse(275, 365, 220, 90));
    const bar = page.getByRole('toolbar', { name: 'Selected ink and text' });
    await expect(bar).toBeVisible();
    for (const name of ['Replay ink', 'Convert to text']) {
      const b = (await bar.getByRole('button', { name }).boundingBox())!;
      await tap(page, kind, b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(1200);
      if (name === 'Replay ink') await expect(page.locator('[data-ink-replay]')).toHaveCount(1);
      else await expect(page.getByRole('dialog')).toHaveCount(1);
      if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: 'Not now' }).click();
      const replay = page.locator('[data-ink-replay]');
      if (await replay.count()) await replay.locator('button', { hasText: 'Close' }).click();
    }
  });
}
