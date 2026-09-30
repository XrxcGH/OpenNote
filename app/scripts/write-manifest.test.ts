// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSignedVersion, manifestFile, manifestFor, readSignature } from './write-manifest.ts';

/**
 * Builds a .sig file the way `tauri signer sign` 2.12 does: a base64-encoded minisign signature.
 * The other lines come from a real signature made with a throwaway key. With the trusted comment
 * `timestamp:1790757747\tfile:OpenNote.exe\tversion:0.1.0`, this returns the CLI's output byte for byte.
 */
function sigFile(trustedComment: string): string {
  const lines = [
    'untrusted comment: signature from tauri secret key',
    'RUS97I79i5LQkiI+5qQ+dIVwWZ58ueG9tsmNLT5qfrBIg9zNsTG1JjV4wtlyACSEiaSMZQQu+wxHyZqE2d6H9XRTKPKaQqxP8wE=',
    `trusted comment: ${trustedComment}`,
    'yb4S2rQXkT42ZlnUrGrXBGPpl63YrNECDSeh/7HvII/7VG7ykqHUvD8F2zzfyaEO5UH2Ctxd0+CqNS9BGiU3Cg==',
  ];
  return Buffer.from(`${lines.join('\n')}\n`).toString('base64');
}

describe('manifestFor', () => {
  it('describes the exe for the tag', () => {
    const manifest = manifestFor('v0.5.0', Buffer.from('abc'), 'sig', 'OpenNote v0.5.0', '2026-09-30T12:00:00.000Z');
    expect(manifest).toEqual({
      version: '0.5.0',
      channel: 'stable',
      notes: 'OpenNote v0.5.0',
      pub_date: '2026-09-30T12:00:00.000Z',
      url: 'https://github.com/XrxcGH/OpenNote/releases/download/v0.5.0/OpenNote.exe',
      size: 3,
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      signature: 'sig',
    });
  });
});

describe('channel choice', () => {
  const manifest = (tag: string) => manifestFor(tag, Buffer.from(''), 'sig', '', '');

  it('writes latest.json for a stable version', () => {
    expect(manifest('v0.5.0').channel).toBe('stable');
    expect(manifestFile(manifest('v0.5.0'))).toBe('latest.json');
  });

  it('writes beta.json for a version with a hyphen', () => {
    expect(manifest('v0.5.0-beta.1').channel).toBe('beta');
    expect(manifestFile(manifest('v0.5.0-beta.1'))).toBe('beta.json');
  });
});

describe('readSignature', () => {
  let dir = '';
  const sigPath = () => join(dir, 'OpenNote.exe.sig');
  const makeDir = () => (dir = mkdtempSync(join(tmpdir(), 'opennote-sig-')));

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the signature without surrounding whitespace', () => {
    makeDir();
    writeFileSync(sigPath(), ` ${sigFile('version:0.5.0')}\n`);
    expect(readSignature(sigPath())).toBe(sigFile('version:0.5.0'));
  });

  it('refuses a missing signature', () => {
    makeDir();
    expect(() => readSignature(sigPath())).toThrow(/No signature found/);
  });

  it('refuses an empty signature', () => {
    makeDir();
    writeFileSync(sigPath(), ' \n');
    expect(() => readSignature(sigPath())).toThrow(/No signature found/);
  });
});

describe('checkSignedVersion', () => {
  it('accepts a signature made with --app-version for the same version', () => {
    const signature = sigFile('timestamp:1790757747\tfile:OpenNote.exe\tversion:0.1.0');
    expect(() => checkSignedVersion(signature, '0.1.0')).not.toThrow();
    const beta = sigFile('timestamp:1790757747\tfile:OpenNote.exe\tversion:0.5.0-beta.1');
    expect(() => checkSignedVersion(beta, '0.5.0-beta.1')).not.toThrow();
  });

  it('refuses a signature for another version', () => {
    const signature = sigFile('timestamp:1790757747\tfile:OpenNote.exe\tversion:0.1.0');
    expect(() => checkSignedVersion(signature, '0.2.0')).toThrow(/names version 0\.1\.0, but the tag is for 0\.2\.0/);
    expect(() => checkSignedVersion(signature, '0.1.0-beta.1')).toThrow(/names version 0\.1\.0/);
  });

  it('refuses a signature made without --app-version', () => {
    const signature = sigFile('timestamp:1790757747\tfile:OpenNote.exe');
    expect(() => checkSignedVersion(signature, '0.1.0')).toThrow(/names no version/);
  });

  it('refuses text that is not a signature', () => {
    expect(() => checkSignedVersion('not a signature', '0.1.0')).toThrow(/no trusted comment/);
  });
});
