// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Manifest } from '../write-manifest.ts';
import {
  appliedIn,
  decodePubFile,
  earlierBeta,
  failureIn,
  localManifest,
  TRAILER,
  withTrailer,
} from './update-test.ts';

describe('update-test.ts', () => {
  it('finds the last beta before the release', () => {
    const tags = ['v0.1.0-beta.3', 'v0.1.0-beta.10', 'v0.1.0-test.1', 'v0.2.0-beta.1', 'channel-manifests', 'v0.0.9'];
    expect(earlierBeta(tags, 'v0.2.0-beta.1')).toBe('v0.1.0-beta.10');
    expect(earlierBeta(tags, 'v0.2.0')).toBe('v0.2.0-beta.1');
    expect(earlierBeta(tags, 'v0.1.0-beta.3')).toBeUndefined();
    expect(earlierBeta([], 'v1.0.0')).toBeUndefined();
  });

  it('points each file of the manifest at the local server and changes nothing the updater checks', () => {
    const manifest: Manifest = {
      version: '0.2.0-beta.1',
      notes: 'n',
      pub_date: '2026-10-07T00:00:00Z',
      channel: 'beta',
      platforms: {
        'windows-x86_64': {
          url: 'https://github.com/XrxcGH/OpenNote/releases/download/v0.2.0-beta.1/OpenNote_Windows64.exe',
          signature: 'sig',
          size: 3,
          sha256: 'abc',
        },
      },
    };
    const local = localManifest(manifest, 'http://127.0.0.1:5000');
    expect(local.platforms['windows-x86_64']).toEqual({
      url: 'http://127.0.0.1:5000/OpenNote_Windows64.exe',
      signature: 'sig',
      size: 3,
      sha256: 'abc',
    });
    expect(local.version).toBe(manifest.version);
  });

  it('marks the test app with its version', () => {
    const marked = withTrailer(Buffer.from('MZ'), '0.1.0-beta.4').toString();
    expect(marked).toBe(`MZ${TRAILER}0.1.0-beta.4`);
  });

  it('reads the public key from a .pub file', () => {
    const text = 'untrusted comment: minisign public key: 1\nRWQ\n';
    expect(decodePubFile(Buffer.from(text).toString('base64'))).toBe(text);
    expect(() => decodePubFile(Buffer.from('nope').toString('base64'))).toThrow(/minisign/);
  });

  it("reads the test app's event log", () => {
    const log = 'started 0.1.0-beta.4\napplied 0.1.0-beta.4 0.2.0-beta.1\n';
    expect(appliedIn(log, '0.1.0-beta.4', '0.2.0-beta.1')).toBe(true);
    expect(appliedIn(log, '0.1.0-beta.3', '0.2.0-beta.1')).toBe(false);
    expect(failureIn('update failed verifyFailed\nupdate failure detail: bad hash')).toBe('update failed verifyFailed');
    expect(failureIn(log)).toBeUndefined();
  });
});
