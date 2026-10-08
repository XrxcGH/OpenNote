// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RELEASE_FILES, type Manifest } from '../write-manifest.ts';
import { fakeExe, fakePe, newTestKey, writeSampleRelease, type TestKey } from './test-support.ts';
import { keysIn, manifestName, verifyRelease } from './verify.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function release(tag: string, options: { exe?: (file: string) => Buffer } = {}) {
  const key = newTestKey();
  const dir = mkdtempSync(join(tmpdir(), 'opennote-verify-'));
  dirs.push(dir);
  const name = writeSampleRelease(dir, tag, key, options);
  const check = (use: { keys?: TestKey[]; authenticode?: boolean; windows?: string } = {}) =>
    verifyRelease({
      dir,
      tag,
      keys: (use.keys ?? [key]).map((each) => each.publicKey),
      requireAuthenticode: use.authenticode,
      windowsStatus: () => use.windows,
    });
  const edit = (change: (manifest: Manifest) => void) => {
    const manifest = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Manifest;
    change(manifest);
    writeFileSync(join(dir, name), JSON.stringify(manifest));
  };
  return { dir, name, key, check, edit };
}

describe('a good release', () => {
  it.each(['v1.0.0', 'v1.0.0-beta.2'])('has no problems (%s)', (tag) => {
    expect(release(tag).check()).toEqual([]);
  });

  it('accepts a signature from any one of several trusted keys', () => {
    const { check, key } = release('v1.0.0');
    expect(check({ keys: [newTestKey(), key] })).toEqual([]);
  });
});

describe('an exe the updater would refuse', () => {
  it('is caught when it changed after it was signed', () => {
    const { dir, check } = release('v1.0.0');
    const changed = Buffer.concat([fakeExe('OpenNote_Windows32.exe'), Buffer.from('!')]);
    writeFileSync(join(dir, 'OpenNote_Windows32.exe'), changed);
    const problems = check().join('\n');
    expect(problems).toContain('OpenNote_Windows32.exe: The signature does not match the file.');
    expect(problems).toContain('says OpenNote_Windows32.exe is');
    expect(problems).toContain('SHA-256 for OpenNote_Windows32.exe');
  });

  it('is caught when another key signed it', () => {
    const { check } = release('v1.0.0');
    expect(check({ keys: [newTestKey()] }).join('\n')).toContain('not signed with a key that this release trusts');
  });

  it('is caught when there is no key to check against', () => {
    expect(release('v1.0.0').check({ keys: [] })[0]).toContain('no update key');
  });

  it('is caught when its signature names another version or file', () => {
    const { dir, key, check } = release('v1.0.0');
    const file = 'OpenNote_Windows64.exe';
    writeFileSync(join(dir, `${file}.sig`), key.signFile(fakeExe(file), file, '0.9.0'));
    expect(check().join('\n')).toContain(`The signature of ${file} does not name version 1.0.0 exactly once.`);
    writeFileSync(join(dir, `${file}.sig`), key.signFile(fakeExe(file), 'other.exe', '1.0.0'));
    expect(check().join('\n')).toContain(`does not name the file ${file} exactly once`);
  });

  it('is caught when the signature repeats a field to hide the real one', () => {
    const { dir, key, check } = release('v1.0.0');
    const file = 'OpenNote_WindowsARM64.exe';
    const comment = `timestamp:1\tversion:0.9.0\tfile:${file}\tversion:1.0.0`;
    writeFileSync(join(dir, `${file}.sig`), key.signWithComment(fakeExe(file), comment));
    expect(check().join('\n')).toContain('does not name version 1.0.0 exactly once');
  });

  it('is caught when a file or its signature is missing', () => {
    const { dir, check } = release('v1.0.0');
    rmSync(join(dir, 'OpenNote_Windows64.exe.sig'));
    rmSync(join(dir, 'OpenNote_Windows32.exe'));
    const problems = check().join('\n');
    expect(problems).toContain('OpenNote_Windows64.exe.sig is missing');
    expect(problems).toContain('OpenNote_Windows32.exe is missing or empty');
  });
});

describe('the Authenticode requirement', () => {
  it('is left alone unless it is asked for', () => {
    expect(release('v1.0.0').check({ authenticode: false })).toEqual([]);
  });

  it('catches an exe with no Authenticode signature', () => {
    const problems = release('v1.0.0').check({ authenticode: true });
    expect(problems).toHaveLength(RELEASE_FILES.length);
    expect(problems[0]).toContain('has no Authenticode signature');
  });

  it('accepts exes that carry one, and that Windows calls valid', () => {
    const signed = (file: string) => Buffer.concat([fakePe({ signed: true }), Buffer.from(file)]);
    expect(release('v1.0.0', { exe: signed }).check({ authenticode: true, windows: 'Valid' })).toEqual([]);
  });

  it('accepts them when nothing can answer for Windows, as off Windows', () => {
    const signed = (file: string) => Buffer.concat([fakePe({ signed: true }), Buffer.from(file)]);
    expect(release('v1.0.0', { exe: signed }).check({ authenticode: true })).toEqual([]);
  });

  it('refuses them when Windows does not trust the certificate', () => {
    const signed = (file: string) => Buffer.concat([fakePe({ signed: true }), Buffer.from(file)]);
    const problems = release('v1.0.0', { exe: signed }).check({ authenticode: true, windows: 'NotTrusted' });
    expect(problems).toHaveLength(RELEASE_FILES.length);
    expect(problems[0]).toBe('Windows says the Authenticode signature of OpenNote_Windows64.exe is NotTrusted.');
  });
});

describe('a manifest the updater would refuse', () => {
  it('is caught when it is missing, or the wrong one for the channel is present', () => {
    const stable = release('v1.0.0');
    rmSync(join(stable.dir, 'latest.json'));
    expect(stable.check()).toContain('latest.json is missing.');
    const beta = release('v1.0.0-beta.1');
    writeFileSync(join(beta.dir, 'latest.json'), '{}');
    expect(beta.check()[0]).toBe('latest.json must not be in a prerelease.');
  });

  it('is caught when it has the wrong version, channel, date, notes, or platforms', () => {
    const { edit, check } = release('v1.0.0');
    edit((manifest) => {
      manifest.version = '0.9.0';
      manifest.channel = 'beta';
      manifest.pub_date = 'yesterday';
      manifest.notes = ' ';
      delete manifest.platforms['windows-i686'];
    });
    const problems = check().join('\n');
    expect(problems).toContain('has version 0.9.0, but the tag is v1.0.0');
    expect(problems).toContain('has channel beta, but 1.0.0 is stable');
    expect(problems).toContain('no valid pub_date');
    expect(problems).toContain('no release notes');
    expect(problems).toContain('lists windows-aarch64, windows-x86_64, but a release has');
    expect(problems).toContain('The manifest has no entry for windows-i686');
  });

  it('is caught when it sends an exe to another address or holds another signature', () => {
    const { edit, check } = release('v1.0.0');
    edit((manifest) => {
      manifest.platforms['windows-x86_64'].url = 'https://evil.example/OpenNote_Windows64.exe';
      manifest.platforms['windows-aarch64'].signature = 'AAAA';
    });
    const problems = check().join('\n');
    expect(problems).toContain('sends OpenNote_Windows64.exe to https://evil.example/');
    expect(problems).toContain('signature for OpenNote_WindowsARM64.exe differs from OpenNote_WindowsARM64.exe.sig');
  });

  it('is caught when the notes are too long for the updater', () => {
    const { edit, check } = release('v1.0.0');
    edit((manifest) => {
      manifest.notes = 'x'.repeat(5000);
    });
    expect(check().join('\n')).toContain('longer than 4096 bytes');
  });

  it('is caught when it is not JSON', () => {
    const { dir, name, check } = release('v1.0.0');
    writeFileSync(join(dir, name), 'not json');
    expect(check()).toContain('latest.json is not valid JSON.');
  });
});

describe('manifestName and keysIn', () => {
  it('puts prereleases in beta.json', () => {
    expect(manifestName('1.0.0')).toBe('latest.json');
    expect(manifestName('1.0.0-beta.1')).toBe('beta.json');
  });

  it('reads every .pub file in a folder, and none from a missing folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opennote-keys-'));
    dirs.push(dir);
    const key = newTestKey();
    writeFileSync(join(dir, 'update.pub'), key.pubFile);
    writeFileSync(join(dir, 'README.md'), 'not a key');
    expect(keysIn(dir)).toEqual([key.publicKey]);
    expect(keysIn(join(dir, 'missing'))).toEqual([]);
  });
});
