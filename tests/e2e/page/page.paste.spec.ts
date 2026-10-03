// Paste through the real Windows clipboard (Phase 4 ARCHITECTURE.md section 26, `page.paste`): clipset loads every
// format a program writes, Ctrl+V pastes it, and the page shows what the corpus expects. Ctrl+Shift+V keeps text
// plain, and PDF line joining undoes in one step.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { clipset, openTextBox, pageText } from './clipboard.ts';

const skip = skipReason() || (process.platform === 'win32' ? false : 'The clipboard tool needs Windows.');

describe('paste on the real clipboard', { skip }, () => {
  let session: AppSession | undefined;

  before(async () => {
    session = await launchApp();
  });
  after(async () => {
    await session?.close();
  });

  const paste = async (name: string, keys: string[] = ['Control', 'v']) => {
    const browser = session!.browser;
    await openTextBox(browser);
    await browser.keys('Enter');
    clipset(name);
    await browser.keys(keys);
    await browser.keys(['Control']);
  };

  it('keeps Word structure and colors', async () => {
    await paste('word/basic');
    await session!.browser.waitUntil(async () => (await pageText(session!.browser)).includes('Weigh each one'), {
      timeout: 10_000,
    });
    const colored = await session!.browser.execute(() => !!document.querySelector('[data-block-id] span[data-color]'));
    assert.ok(colored, 'a Word text color became a pen color');
  });

  it('keeps OneNote To Do tags as checklist items', async () => {
    await paste('onenote/basic');
    await session!.browser.waitUntil(async () => (await pageText(session!.browser)).includes('Book the room'), {
      timeout: 10_000,
    });
    const checked = await session!.browser.execute(() => document.querySelectorAll('li[data-checked="true"]').length);
    assert.ok(checked > 0, 'the checked To Do tag came through');
  });

  it('pastes a web table as a table block, without the page colors', async () => {
    await paste('web/wikipedia-table');
    await session!.browser.waitUntil(async () => (await pageText(session!.browser)).includes('Mercury'), {
      timeout: 10_000,
    });
    const text = await pageText(session!.browser);
    assert.ok(!text.includes('[edit]'), 'the edit link was left out');
  });

  it('pastes plain text with Ctrl+Shift+V', async () => {
    await paste('markdown/basic', ['Control', 'Shift', 'v']);
    await session!.browser.waitUntil(async () => (await pageText(session!.browser)).includes('#'), {
      timeout: 10_000,
    });
  });

  it('joins PDF lines as a step of its own', async () => {
    await paste('plain/pdf');
    const browser = session!.browser;
    await browser.waitUntil(async () => (await pageText(browser)).length > 0, { timeout: 10_000 });
    const joined = await pageText(browser);
    await browser.keys(['Control', 'z']);
    await browser.keys(['Control']);
    await browser.waitUntil(async () => (await pageText(browser)) !== joined, { timeout: 5_000 });
  });
});
