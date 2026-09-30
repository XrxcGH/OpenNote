// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RELEASE_FILES,
  checkSignedVersion,
  manifestFile,
  manifestFor,
  platformEntry,
  readReleaseFile,
  readSignature,
  writeManifest,
} from './write-manifest.ts';

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

const signedFor = (file: string, version: string) => sigFile(`timestamp:1790757747\tfile:${file}\tversion:${version}`);

// Temporary folders made by a test, removed after it.
let dirs: string[] = [];
const makeDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-release-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  dirs = [];
});

/** A release folder with every file and its signature, as the build and signing steps leave it. */
function releaseDir(version: string): string {
  const dir = makeDir();
  for (const { file } of RELEASE_FILES) {
    writeFileSync(join(dir, file), `the exe in ${file}`);
    writeFileSync(join(dir, `${file}.sig`), signedFor(file, version));
  }
  return dir;
}

describe('RELEASE_FILES', () => {
  it('names one exe per Windows architecture under its Tauri updater key', () => {
    expect(RELEASE_FILES.map(({ target, platform, file }) => [target, platform, file])).toEqual([
      ['x86_64-pc-windows-msvc', 'windows-x86_64', 'OpenNote_Windows64.exe'],
      ['i686-pc-windows-msvc', 'windows-i686', 'OpenNote_Windows32.exe'],
      ['aarch64-pc-windows-msvc', 'windows-aarch64', 'OpenNote_WindowsARM64.exe'],
    ]);
  });

  it('matches the build matrix in the release workflow', () => {
    const workflow = readFileSync(join(import.meta.dirname, '..', '..', '.github', 'workflows', 'release.yml'), 'utf8');
    const lines = workflow.split(/\r?\n/).map((line) => line.trim());
    for (const { target, file } of RELEASE_FILES) {
      const at = lines.indexOf(`- target: ${target}`);
      expect(at, `release.yml builds ${target}`).toBeGreaterThan(-1);
      expect(lines[at + 1]).toBe(`file: ${file}`);
    }
  });
});

describe('manifestFor', () => {
  it('describes each file under its platform key', () => {
    const entry = platformEntry('v0.5.0', 'OpenNote_Windows64.exe', Buffer.from('abc'), 'sig');
    const manifest = manifestFor('v0.5.0', { 'windows-x86_64': entry }, 'OpenNote v0.5.0', '2026-09-30T12:00:00.000Z');
    expect(manifest).toEqual({
      version: '0.5.0',
      notes: 'OpenNote v0.5.0',
      pub_date: '2026-09-30T12:00:00.000Z',
      channel: 'stable',
      platforms: {
        'windows-x86_64': {
          url: 'https://github.com/XrxcGH/OpenNote/releases/download/v0.5.0/OpenNote_Windows64.exe',
          signature: 'sig',
          size: 3,
          sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        },
      },
    });
  });
});

describe('channel choice', () => {
  const manifest = (tag: string) => manifestFor(tag, {}, '', '');

  it('writes latest.json for a stable version', () => {
    expect(manifest('v0.5.0').channel).toBe('stable');
    expect(manifestFile(manifest('v0.5.0'))).toBe('latest.json');
  });

  it('writes beta.json for a version with a hyphen', () => {
    expect(manifest('v0.5.0-beta.1').channel).toBe('beta');
    expect(manifestFile(manifest('v0.5.0-beta.1'))).toBe('beta.json');
  });
});

describe('readReleaseFile and readSignature', () => {
  it('return the contents, with the signature trimmed', () => {
    const dir = makeDir();
    writeFileSync(join(dir, 'OpenNote_Windows64.exe'), 'exe');
    writeFileSync(join(dir, 'OpenNote_Windows64.exe.sig'), ` ${sigFile('version:0.5.0')}\n`);
    expect(readReleaseFile(join(dir, 'OpenNote_Windows64.exe')).toString()).toBe('exe');
    expect(readSignature(join(dir, 'OpenNote_Windows64.exe.sig'))).toBe(sigFile('version:0.5.0'));
  });

  it('refuse a missing or empty file', () => {
    const dir = makeDir();
    const exe = join(dir, 'OpenNote_Windows64.exe');
    expect(() => readReleaseFile(exe)).toThrow(/No release file found/);
    expect(() => readSignature(`${exe}.sig`)).toThrow(/No signature found/);
    writeFileSync(exe, '');
    writeFileSync(`${exe}.sig`, ' \n');
    expect(() => readReleaseFile(exe)).toThrow(/No release file found/);
    expect(() => readSignature(`${exe}.sig`)).toThrow(/No signature found/);
  });
});

describe('checkSignedVersion', () => {
  const file = 'OpenNote_Windows64.exe';

  it('accepts a signature made with --app-version for the same version', () => {
    expect(() => checkSignedVersion(signedFor(file, '0.1.0'), '0.1.0', file)).not.toThrow();
    expect(() => checkSignedVersion(signedFor(file, '0.5.0-beta.1'), '0.5.0-beta.1', file)).not.toThrow();
  });

  it('refuses a signature for another version, and names the file', () => {
    const signature = signedFor(file, '0.1.0');
    const expected = /OpenNote_Windows64\.exe names version 0\.1\.0, but the tag is for 0\.2\.0/;
    expect(() => checkSignedVersion(signature, '0.2.0', file)).toThrow(expected);
    expect(() => checkSignedVersion(signature, '0.1.0-beta.1', file)).toThrow(/names version 0\.1\.0/);
  });

  it('refuses a signature made without --app-version', () => {
    const signature = sigFile(`timestamp:1790757747\tfile:${file}`);
    expect(() => checkSignedVersion(signature, '0.1.0', file)).toThrow(/names no version/);
  });

  it('refuses text that is not a signature', () => {
    expect(() => checkSignedVersion('not a signature', '0.1.0', file)).toThrow(/no trusted comment/);
  });
});

describe('writeManifest', () => {
  const date = '2026-09-30T12:00:00.000Z';

  it('writes latest.json with every file for a stable tag', () => {
    const dir = releaseDir('0.5.0');
    const { name, manifest } = writeManifest(dir, 'v0.5.0', 'notes', date);
    expect(name).toBe('latest.json');
    expect(JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'))).toEqual(manifest);
    expect(Object.keys(manifest.platforms)).toEqual(['windows-x86_64', 'windows-i686', 'windows-aarch64']);
    for (const { platform, file } of RELEASE_FILES) {
      const contents = readFileSync(join(dir, file));
      expect(manifest.platforms[platform]).toEqual(platformEntry('v0.5.0', file, contents, signedFor(file, '0.5.0')));
    }
  });

  it('writes only beta.json for a prerelease tag', () => {
    const dir = releaseDir('0.5.0-beta.1');
    const { name, manifest } = writeManifest(dir, 'v0.5.0-beta.1', 'notes', date);
    expect(name).toBe('beta.json');
    expect(manifest.channel).toBe('beta');
    expect(Object.keys(manifest.platforms)).toHaveLength(RELEASE_FILES.length);
    expect(existsSync(join(dir, 'latest.json'))).toBe(false);
  });

  it.each(RELEASE_FILES.map(({ file }) => file))('stops when %s or its signature is missing', (file) => {
    const dir = releaseDir('0.5.0');
    rmSync(join(dir, `${file}.sig`));
    expect(() => writeManifest(dir, 'v0.5.0', 'notes', date)).toThrow(/No signature found/);
    rmSync(join(dir, file));
    expect(() => writeManifest(dir, 'v0.5.0', 'notes', date)).toThrow(/No release file found/);
    expect(existsSync(join(dir, 'latest.json'))).toBe(false);
  });

  it.each(RELEASE_FILES.map(({ file }) => file))('stops when %s is signed for another version', (file) => {
    const dir = releaseDir('0.5.0');
    writeFileSync(join(dir, `${file}.sig`), signedFor(file, '0.4.1'));
    expect(() => writeManifest(dir, 'v0.5.0', 'notes', date)).toThrow(`The signature of ${file} names version 0.4.1`);
    expect(existsSync(join(dir, 'latest.json'))).toBe(false);
  });
});
