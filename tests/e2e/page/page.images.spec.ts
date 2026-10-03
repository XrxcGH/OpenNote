// Images in the real app (Phase 4 ARCHITECTURE.md section 26, `page.images`): a screenshot on the clipboard pastes
// as an image block whose size came from the shell's probe, and it survives a restart through the asset scheme.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { clipset, openTextBox } from './clipboard.ts';

const skip = skipReason() || (process.platform === 'win32' ? false : 'The clipboard tool needs Windows.');

describe('images on the real clipboard', { skip }, () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'opennote-e2e-images-'));
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
    rmSync(profileDir, { recursive: true, force: true });
  });

  const imageSize = (session: AppSession) =>
    session.browser.execute(() => {
      const image = document.querySelector<HTMLImageElement>('[data-block-id] img');
      return image ? { width: image.getAttribute('width'), height: image.getAttribute('height') } : null;
    });

  it('pastes a screenshot as an image block that loads and survives a restart', async () => {
    session = await launchApp({ profileDir });
    await openTextBox(session.browser);
    clipset('image/screenshot');
    await session.browser.keys(['Control', 'v']);
    await session.browser.keys(['Control']);
    await session.browser.waitUntil(async () => (await imageSize(session!)) !== null, { timeout: 15_000 });
    const loaded = await session.browser.waitUntil(
      () => session!.browser.execute(() => document.querySelector<HTMLImageElement>('[data-block-id] img')?.complete),
      { timeout: 10_000 },
    );
    assert.ok(loaded, 'the image loaded through opennote-asset');
    const size = await imageSize(session);
    await session.close();
    session = await launchApp({ profileDir });
    await openTextBox(session.browser);
    await session.browser.waitUntil(async () => (await imageSize(session!)) !== null, { timeout: 15_000 });
    assert.deepEqual(await imageSize(session), size);
  });
});
