// Ink in the real app reaches Phase 3's core and survives a restart: open a page, choose a pen on the Draw tab, draw
// a stroke, close the app, start it again on the same profile, and find the ink. Then undo takes it away, and that
// survives a restart too. The stroke is pen pointer events sent to the page, which take the same path as a pen.
//
// The app is closed the way the harness closes it, which ends the process at once, so the stroke has to be in the
// core's journal by then. The page draws a stroke before the core has it (the send queue flushes first), so the
// spec waits for what a person would: the title bar saying Saved, which it says only once the core has the
// stroke in its journal file. It then waits for the journal itself, so a stroke lost there fails as lost, not as
// a stroke that didn't come back. When the stroke doesn't come back, the spec keeps a screenshot, what the page
// says, and the profile with its journals, in tests/e2e/logs, which CI uploads.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { keepAppLogs, launchApp, LOGS, skipReason } from '../harness.ts';
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

/**
 * Chooses the pen on the Draw tab. A window wide enough shows the pen slots on the bar, and the first one is clicked.
 * A narrower one moves them into the More menu, where only the Pen tool is left, and that one is chosen.
 */
async function choosePen(browser: Browser): Promise<void> {
  await browser.execute(() => {
    [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent === 'Draw')?.click();
  });
  await browser.waitUntil(
    () => browser.execute(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Draw'),
    { timeout: 10_000 },
  );
  const onBar = await browser
    .waitUntil(() => browser.execute(() => document.querySelector('[data-ink-slot="p1"]') !== null), { timeout: 2_000 })
    .catch(() => false);
  if (onBar) {
    await browser.execute(() => document.querySelector<HTMLElement>('[data-ink-slot="p1"]')!.click());
    return;
  }
  await browser.execute(() => {
    [...document.querySelectorAll<HTMLElement>('[role="tabpanel"] button')]
      .find((button) => button.textContent === 'More')
      ?.click();
  });
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const item = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')].find(
          (candidate) => candidate.textContent === 'Pen',
        );
        item?.click();
        return Boolean(item);
      }),
    { timeout: 10_000, timeoutMsg: 'neither a pen slot nor the Pen item in More showed' },
  );
}

/** Chooses the pen, then draws a line with pen pointer events. */
async function drawLine(browser: Browser, y: number): Promise<void> {
  await choosePen(browser);
  await browser.execute((y) => {
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

/** What the title bar's save status says, or null when it isn't on the bar. */
function saveStatus(browser: Browser): Promise<string | null> {
  return browser.execute(() => document.querySelector('[data-save-status]')?.getAttribute('data-status') ?? null);
}

/** How many added-strokes records the profile's journals hold. */
function journalStrokes(folder: string): number {
  if (!existsSync(folder)) return 0;
  let found = 0;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    // The WebView2 profile (EBWebView, or the harness's own webview folder) holds no journals and many files.
    if (entry.isDirectory() && !/webview/i.test(entry.name)) found += journalStrokes(path);
    else if (entry.name.endsWith('.wal')) {
      try {
        found += readFileSync(path).toString('latin1').split('"addStrokes"').length - 1;
      } catch {
        // A generation that went between the listing and the read.
      }
    }
  }
  return found;
}

/** What the page shows besides the ink: the save status, its notices and dialogs, and the page's title. */
function pageReport(browser: Browser): Promise<string> {
  return browser.execute(() => {
    const said = [...document.querySelectorAll('[role="status"],[role="alert"],[role="dialog"],[role="alertdialog"]')]
      .map((node) => `${node.getAttribute('role')}: ${(node.textContent ?? '').trim().slice(0, 160)}`)
      .filter((line) => !line.endsWith(': '));
    const tiles = document.querySelectorAll('[data-ink-tiles] canvas').length;
    const status = document.querySelector('[data-save-status]')?.getAttribute('data-status') ?? 'none';
    return `save status ${status}; ${tiles} tiles; title "${document.title}"; ${said.join(' | ') || 'no notices'}`;
  });
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
    await session.browser.waitUntil(async () => (await saveStatus(session!.browser)) === 'saved', {
      timeout: 10_000,
      timeoutMsg: 'the title bar never said Saved after the stroke',
    });
    // "Saved" means the stroke is in the journal file, so one read is enough, with no wait for the disk. A core that
    // answered before the journal thread wrote the record (the gap this checks) fails here.
    const before = journalStrokes(profileDir);
    assert.ok(before > 0, 'the title bar said Saved before the stroke was in the journal');
    await session.close();
    const kept = journalStrokes(profileDir);

    session = await launchApp({ profileDir });
    await openMitosis(session.browser);
    await session.browser
      .waitUntil(async () => (await inkPixels(session!.browser)) > 100, { timeout: 20_000 })
      .catch(async () => {
        const stamp = Date.now();
        mkdirSync(LOGS, { recursive: true });
        await session!.browser.saveScreenshot(join(LOGS, `ink-restart-${stamp}.png`)).catch(() => undefined);
        const report = await pageReport(session!.browser).catch((error: unknown) => String(error));
        keepAppLogs(profileDir, stamp);
        assert.fail(
          `the ink came back after the restart (journal strokes after the close: ${kept}; ${report}; ` +
            `evidence in tests/e2e/logs/app-${stamp})`,
        );
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
