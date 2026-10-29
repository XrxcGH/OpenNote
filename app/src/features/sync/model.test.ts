import { describe, expect, it } from 'vitest';
import { createFakeSync, FAKE_SECRETS } from './fake';
import { checkGroups, chipText, groupMatches, passphraseProblem, placeReady, qrPath, summaryLines } from './model';
import { SyncFailure } from './types';
import type { Summary, SyncStatus } from './types';

const EMPTY: Summary = { upload: [], download: [], delete: [], conflicts: [], bytesUp: 0, bytesDown: 0 };
const KEY = 'TEST-ONLY-FAKE-0000-1111-2222-3333-4444-5555-6666-7777-8888-9999';

describe('the recovery key check', () => {
  it('asks for two different groups that exist', () => {
    for (const key of [KEY, KEY.replace('TEST', 'BEST'), 'AAAA-BBBB-CCCC']) {
      const [first, second] = checkGroups(key);
      const count = key.split('-').length;
      expect(first).toBeGreaterThanOrEqual(1);
      expect(second).toBeGreaterThan(first);
      expect(second).toBeLessThanOrEqual(count);
    }
  });

  it('accepts what people type: any case, spaces, and O for 0 or l for 1', () => {
    expect(groupMatches(KEY, 4, '0000')).toBe(true);
    expect(groupMatches(KEY, 4, 'oooo')).toBe(true);
    expect(groupMatches(KEY, 5, ' 11 l1 ')).toBe(true);
    expect(groupMatches(KEY, 1, 'test')).toBe(true);
    expect(groupMatches(KEY, 1, 'tesx')).toBe(false);
    expect(groupMatches(KEY, 14, '0000')).toBe(false);
  });
});

describe('the setup checks', () => {
  it('wants a passphrase of 10 characters typed the same twice', () => {
    expect(passphraseProblem('short', 'short')).toBe('Use at least 10 characters.');
    expect(passphraseProblem('correct horse', 'correct horsE')).toBe('The two passphrases differ. Type them again.');
    expect(passphraseProblem('correct horse', 'correct horse')).toBeNull();
    expect(passphraseProblem('ñandú ñandú', 'ñandú ñandú')).toBeNull();
  });

  it('needs a folder, or a server address that starts with http', () => {
    expect(placeReady({ kind: 'folder', path: '  ' })).toBe(false);
    expect(placeReady({ kind: 'folder', path: 'D:\\Sync' })).toBe(true);
    expect(placeReady({ kind: 'webdav', url: 'cloud.example.com', username: '' })).toBe(false);
    expect(placeReady({ kind: 'webdav', url: 'https://cloud.example.com/dav', username: 'sam' })).toBe(true);
  });
});

describe('the words of a preview', () => {
  it('counts each kind of change, with sizes', () => {
    expect(summaryLines(EMPTY)).toEqual(['Everything is already the same here and in storage.']);
    const all = summaryLines({
      ...EMPTY,
      upload: ['a', 'b'],
      bytesUp: 2048,
      download: ['c'],
      bytesDown: 10,
      delete: ['d'],
      conflicts: [{ path: 'p', keptAs: 'q' }],
    });
    expect(all).toHaveLength(4);
    expect(all[0]).toMatch(/^Sends 2 files \(/);
    expect(all[2]).toBe('Removes 1 file deleted on another device.');
    expect(summaryLines({ ...EMPTY, download: ['c'], bytesDown: 10 })[0]).toMatch(/^Brings in 1 file \(/);
  });
});

describe('the title bar notice', () => {
  const status: SyncStatus = { state: 'synced', lastSync: 1, errorCode: null, error: null, conflicts: 0 };
  const view = { backend: null, deviceName: null, fingerprint: null };

  it('shows only once sync is set up', () => {
    expect(chipText(null)).toBeNull();
    expect(chipText({ ...view, configured: false, status })).toBeNull();
    expect(chipText({ ...view, configured: true, status })).toBe('Synced');
    expect(chipText({ ...view, configured: true, status: { ...status, state: 'error' } })).toBe('Sync stopped');
  });

  it('draws one square for each dark module, inside the quiet zone', () => {
    expect(qrPath(['10', '01'])).toBe('M4 4h1v1h-1zM5 5h1v1h-1z');
    expect(qrPath(['00'])).toBe('');
  });
});

describe('the in-memory host', () => {
  it('follows the shell: weak passphrases, a recovery key once, codes once, and pause', async () => {
    const host = createFakeSync({ now: () => 1_000 });
    const backend = { kind: 'folder' as const, path: 'D:\\Sync' };
    await expect(host.setUp({ backend, deviceName: 'Laptop', passphrase: 'short' })).rejects.toEqual(
      new SyncFailure('weakPassphrase'),
    );
    const made = await host.setUp({ backend, deviceName: 'Laptop', passphrase: FAKE_SECRETS.passphrase });
    expect(made.recoveryKey?.split('-')).toHaveLength(13);
    expect((await host.status()).recoveryKey).toBeUndefined();
    await expect(host.setUp({ backend, deviceName: 'x', passphrase: FAKE_SECRETS.passphrase })).rejects.toEqual(
      new SyncFailure('vaultExists'),
    );
    const { code } = await host.pairingCode();
    const other = createFakeSync();
    await expect(other.join({ backend, deviceName: 'Desktop', code })).rejects.toEqual(
      new SyncFailure('pairingExpired'),
    );
    await host.setPaused(true);
    expect((await host.status()).status.state).toBe('paused');
    await expect(host.syncNow()).rejects.toEqual(new SyncFailure('paused'));
    await host.setPaused(false);
    expect((await host.syncNow()).view.status.state).toBe('synced');
    await host.turnOff();
    expect((await host.status()).configured).toBe(false);
  });

  it('waits while Work offline is on', async () => {
    let offline = true;
    const host = createFakeSync({ configured: true, offline: () => offline });
    expect((await host.status()).status.state).toBe('offline');
    await expect(host.preview()).rejects.toEqual(new SyncFailure('offline'));
    offline = false;
    expect((await host.preview()).summary.download).toHaveLength(1);
  });
});
