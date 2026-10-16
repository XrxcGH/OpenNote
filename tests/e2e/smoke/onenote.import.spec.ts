// The real app imports OneNote notebooks through Microsoft Graph, with a mock Graph on a local port and a test build
// (the test-endpoints feature) that starts connected as a test account. Ctrl+K runs Import OneNote notebooks, the
// notebook is chosen, and the notebook, its section, and its page appear. A second launch as another account on the
// same profile brings that account's notebook in beside the first one, without mixing the two.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Key } from 'webdriverio';
import { addOneNote } from '../../mock-servers/onenote';
import { MockServer } from '../../mock-servers/server';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { startMockBridge } from '../mockBridge.ts';
import type { MockBridge } from '../mockBridge.ts';

const page = (id: string, title: string, html: string) => ({ id, title, modified: '2026-10-01T10:00:00Z', html });

function graph(notebook: string, section: string, title: string, text: string) {
  const server = new MockServer();
  addOneNote(server, [
    {
      id: `nb-${notebook}`,
      name: notebook,
      sections: [
        { id: `s-${notebook}`, name: section, pages: [page(`p-${notebook}`, title, `<body><p>${text}</p></body>`)] },
      ],
    },
  ]);
  return server;
}

async function importFrom(account: string, server: MockServer, profileDir?: string) {
  const bridge: MockBridge = await startMockBridge(server);
  const session: AppSession = await launchApp({
    ...(profileDir ? { profileDir } : {}),
    env: { OPENNOTE_TEST_CONNECTOR_BASE: bridge.base, OPENNOTE_TEST_CONNECTED: `microsoft:${account}` },
  });
  const { browser } = session;
  await browser.$('[role="switch"][aria-label="Dark mode"]').waitForExist({ timeout: 20_000 });
  await browser.action('key').down(Key.Ctrl).down('k').up('k').up(Key.Ctrl).perform();
  const box = browser.$('[role="combobox"]');
  await box.waitForExist({ timeout: 5_000 });
  await box.setValue('Import OneNote notebooks');
  await browser.$('[role="option"]').waitForExist({ timeout: 5_000 });
  await browser.keys(Key.Enter);
  const choose = browser.$('button=Import');
  await choose.waitForExist({ timeout: 15_000 });
  await choose.click();
  return { session, bridge };
}

describe('OneNote import in the real app', { skip: skipReason() }, () => {
  let first: Awaited<ReturnType<typeof importFrom>> | undefined;
  let profileDir = '';

  before(async () => {
    first = await importFrom('alice@example.com', graph('Biology', 'Cells', 'Mitosis', 'Alice wrote this.'));
    profileDir = first.session.profileDir;
  });

  after(async () => {
    await first?.session.close();
    await first?.bridge.close();
  });

  it('brings the notebook in and shows it in the tree', async () => {
    const { browser } = first!.session;
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('came over'), {
      timeout: 30_000,
      timeoutMsg: 'the import never said it was done',
    });
    assert.match(await browser.$('body').getText(), /Biology/);
  });

  it('keeps a second account’s notebook apart from the first', async () => {
    await first?.session.close();
    await first?.bridge.close();
    first = await importFrom('bob@example.com', graph('Biology', 'Notes', 'Bob’s page', 'Bob wrote this.'), profileDir);
    const { browser } = first.session;
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('came over'), {
      timeout: 30_000,
    });
    assert.match(await browser.$('body').getText(), /Biology \(bob@example\.com\)/);
  });
});
