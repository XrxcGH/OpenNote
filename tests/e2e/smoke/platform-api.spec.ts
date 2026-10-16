// The real app's local API in a fresh profile. In beta builds the API starts on with no apps connected: the app
// writes its endpoint and per-instance key files into the profile, listens on loopback only, and refuses a call
// without a token while answering the open status route. Settings > App permissions shows it on, and Copy MCP
// config, with a name for page history, comes back from the shell with the opennote tool's path and `--author`.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Key } from 'webdriverio';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';

describe('the local API panel in the real app', { skip: skipReason() }, () => {
  let session: AppSession;

  before(async () => {
    session = await launchApp();
  });

  after(async () => {
    await session?.close();
  });

  it('listens on loopback with a key file, and refuses a call without a token', async () => {
    const local = join(session.profileDir, 'local');
    const endpoint = join(local, 'api-endpoint.json');
    await session.browser.waitUntil(async () => existsSync(endpoint), {
      timeout: 20_000,
      timeoutMsg: 'the API never wrote api-endpoint.json',
    });
    const key = readFileSync(join(local, 'api-instance.key'), 'utf8').trim();
    assert.ok(key.length >= 43, 'a 256-bit key');
    const { port } = JSON.parse(readFileSync(endpoint, 'utf8')) as { port: number };
    const status = await fetch(`http://127.0.0.1:${port}/v1/status`);
    assert.equal(status.status, 200);
    const refused = await fetch(`http://127.0.0.1:${port}/v1/commands`);
    assert.equal(refused.status, 401);
  });

  it('shows App permissions on, and copies an MCP config that names the assistant', async () => {
    const { browser } = session;
    await browser.$('[role="switch"][aria-label="Dark mode"]').waitForExist({ timeout: 20_000 });
    await browser.action('key').down(Key.Ctrl).down(',').up(',').up(Key.Ctrl).perform();
    await browser.$('h1=General').waitForExist({ timeout: 5_000 });
    await browser.$('//nav//a[normalize-space(.)="App permissions"]').click();
    await browser.$('h1=App permissions').waitForExist({ timeout: 5_000 });

    const api = browser.$(
      '//*[@role="switch"][@aria-label="Let apps on this PC connect" or normalize-space(.)="Let apps on this PC connect"]',
    );
    await api.waitForExist({ timeout: 5_000 });
    assert.equal(await api.getAttribute('aria-checked'), 'true');

    // The clipboard can refuse in an unfocused window, so read what the shell hands back instead.
    await browser.execute(() => {
      const w = window as unknown as { __copied?: string };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (text: string) => ((w.__copied = text), Promise.resolve()) },
      });
    });
    const name = browser.$('//label[normalize-space(.)="Name in page history (optional)"]');
    const field = browser.$(`#${await name.getAttribute('for')}`);
    await field.setValue('Claude (copyedit)');
    await browser.$('button=Copy MCP config').click();
    await browser.waitUntil(
      async () => Boolean(await browser.execute(() => (window as unknown as { __copied?: string }).__copied)),
      { timeout: 5_000, timeoutMsg: 'Copy MCP config never wrote a config' },
    );
    const copied = await browser.execute(() => (window as unknown as { __copied?: string }).__copied ?? '');
    const config = JSON.parse(copied) as { mcpServers: { opennote: { command: string; args: string[] } } };
    assert.deepEqual(config.mcpServers.opennote.args, ['mcp', '--author', 'Claude (copyedit)']);
    assert.match(config.mcpServers.opennote.command, /opennote\.exe$/);
    await browser.keys(Key.Escape);
  });
});
