// Ink in the real app reaches Phase 3's core and survives a restart: open a page, choose a pen on the Draw tab, draw
// a stroke, close the app, start it again on the same profile, and find the ink. Then undo takes it away, and that
// survives a restart too. The stroke is pen pointer events sent to the page, which take the same path as a pen.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession, Browser } from '../harness.ts';

/** Clicks the row of a tree whose label reads `name`, once it shows. */
async function clickRow(browser: Browser, tree: string, name: string): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (tree, name) => {
          const rows = document.querySelectorAll(`[role="tree"][aria-label="${tree}"] [role="treeitem"]`);
          const row = [...rows].find(
            (candidate) =>
              document.getElementById(candidate.getAttribute('aria-labelledby') ?? '')?.textContent === name,
          );
          (row as HTMLElement | undefined)?.click();
          return Boolean(row);
        },
        tree,
        name,
      ),
    { timeout: 20_000 },
  );
}

/** Opens Mitosis and waits for the ink overlay over it. */
async function openMitosis(browser: Browser): Promise<void> {
  await clickRow(browser, 'Notebooks', 'Lectures');
  await clickRow(browser, 'Pages', 'Mitosis');
  await browser.waitUntil(() => browser.execute(() => document.querySelector('[data-ink-overlay]') !== null), {
    timeout: 20_000,
  });
}

/** How many pixels of ink the visible tiles hold. */
function inkPixels(browser: Browser): Promise<number> {
  return browser.execute(() => {
    let ink = 0;
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-ink-tiles] canvas')) {
      if (canvas.style.display === 'none') continue;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) ink++;
    }
    return ink;
  });
}

/** Chooses the first pen on the Draw tab, then draws a line with pen pointer events. */
async function drawLine(browser: Browser, y: number): Promise<void> {
  await browser.execute(() => {
    [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent === 'Draw')?.click();
  });
  await browser.waitUntil(() => browser.execute(() => document.querySelector('[data-ink-slot="p1"]') !== null), {
    timeout: 10_000,
  });
  await browser.execute((y) => {
    document.querySelector<HTMLElement>('[data-ink-slot="p1"]')!.click();
    const box = document.querySelector('[data-ink-overlay]')!.getBoundingClientRect();
    const target = document.elementFromPoint(box.x + 120, box.y + y)!;
    const send = (type: string, x: number, y: number, buttons: number, t: number) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 7,
          pointerType: 'pen',
          isPrimary: true,
          clientX: box.x + x,
          clientY: box.y + y,
          button: type === 'pointermove' ? -1 : 0,
          buttons,
          pressure: buttons ? 0.4 + (t % 5) / 10 : 0,
        }),
      );
    send('pointerdown', 120, y, 1, 0);
    for (let i = 1; i <= 30; i++) send('pointermove', 120 + i * 10, y + Math.sin(i / 3) * 20, 1, i);
    send('pointerup', 420, y, 0, 31);
  }, y);
}

describe('ink survives a restart', { skip: skipReason() }, () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'opennote-e2e-ink-'));
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
    rmSync(profileDir, { recursive: true, force: true });
  });

  it('keeps a stroke drawn on a page, and keeps its undo', async () => {
    session = await launchApp({ profileDir });
    await openMitosis(session.browser);
    await drawLine(session.browser, 300);
    await session.browser.waitUntil(async () => (await inkPixels(session!.browser)) > 100, { timeout: 5_000 });
    await session.close();

    session = await launchApp({ profileDir });
    await openMitosis(session.browser);
    await session.browser.waitUntil(async () => (await inkPixels(session!.browser)) > 100, {
      timeout: 20_000,
      timeoutMsg: 'the ink came back after the restart',
    });
    // The stroke drew on the previous run, so this run's undo has nothing of it; draw again and undo that.
    const once = await inkPixels(session.browser);
    await drawLine(session.browser, 420);
    await session.browser.waitUntil(async () => (await inkPixels(session!.browser)) > once, { timeout: 5_000 });
    const twice = await inkPixels(session.browser);
    await session.browser.keys(['Control', 'z']);
    await session.browser.waitUntil(async () => (await inkPixels(session!.browser)) < twice, { timeout: 5_000 });
    assert.ok((await inkPixels(session.browser)) > 100, 'undo took only the stroke drawn on this run');
  });
});
