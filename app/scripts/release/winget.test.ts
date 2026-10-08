// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RELEASE_FILES, type Manifest } from '../write-manifest.ts';
import { newTestKey, writeSampleRelease } from './test-support.ts';
import { CONFIG_PATH, configProblems, scalar, wingetFiles, type WingetConfig } from './winget.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as WingetConfig;

function releaseManifest(tag: string, notes = 'Typed notes.\nPen drawing.'): Manifest {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-winget-'));
  dirs.push(dir);
  const name = writeSampleRelease(dir, tag, newTestKey(), { notes });
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as Manifest;
}

describe('the package details in app/winget.json', () => {
  it('follow the rules of the winget manifest schema', () => {
    expect(configProblems(config)).toEqual([]);
    expect(config.PackageIdentifier).toBe('XrxcGH.OpenNote');
  });

  it('are checked for the mistakes winget would reject', () => {
    const bad = {
      ...config,
      PackageIdentifier: 'OpenNote',
      ShortDescription: 'x'.repeat(257),
      Tags: Array.from({ length: 17 }, (_, at) => `tag${at}`),
      PackageUrl: 'http://example.com',
    };
    expect(configProblems(bad)).toEqual([
      '"OpenNote" is not a valid PackageIdentifier.',
      'ShortDescription is longer than 256 characters.',
      'Tags are limited to 16, of 40 characters each.',
      'PackageUrl must be an https address.',
    ]);
  });
});

describe('scalar', () => {
  it('writes safe text bare and everything else in double quotes', () => {
    expect(scalar('OpenNote')).toBe('OpenNote');
    expect(scalar('note-taking')).toBe('note-taking');
    expect(scalar('1.0.0')).toBe('1.0.0');
    expect(scalar('1.0.0-beta.1')).toBe('1.0.0-beta.1');
    expect(scalar('a: b')).toBe('"a: b"');
    expect(scalar('with, comma')).toBe('"with, comma"');
    expect(scalar('say "hi"')).toBe('"say \\"hi\\""');
    expect(scalar('yes')).toBe('"yes"');
    expect(scalar('1.5')).toBe('"1.5"');
    expect(scalar('')).toBe('""');
  });
});

describe('wingetFiles', () => {
  const manifest = releaseManifest('v1.0.0');
  const files = wingetFiles(config, manifest, 'v1.0.0');
  const folder = 'manifests/x/XrxcGH/OpenNote/1.0.0';

  it('makes the version, installer, and locale files where winget-pkgs expects them', () => {
    expect(Object.keys(files)).toEqual([
      `${folder}/XrxcGH.OpenNote.yaml`,
      `${folder}/XrxcGH.OpenNote.installer.yaml`,
      `${folder}/XrxcGH.OpenNote.locale.en-US.yaml`,
    ]);
    expect(files[`${folder}/XrxcGH.OpenNote.yaml`]).toContain('ManifestType: version');
  });

  it('lists one portable installer per architecture, with the hash the updater checks', () => {
    const text = files[`${folder}/XrxcGH.OpenNote.installer.yaml`];
    expect(text).toContain('InstallerType: portable');
    expect(text).toContain('- Architecture: x64');
    expect(text).toContain('- Architecture: x86');
    expect(text).toContain('- Architecture: arm64');
    for (const { platform, file } of RELEASE_FILES) {
      const entry = manifest.platforms[platform];
      expect(text).toContain(`InstallerUrl: https://github.com/XrxcGH/OpenNote/releases/download/v1.0.0/${file}`);
      expect(text).toContain(`InstallerSha256: ${entry.sha256.toUpperCase()}`);
    }
    expect(text).toContain('ReleaseDate: 2026-10-14');
  });

  it('puts the release notes in a block, so punctuation in them is safe', () => {
    const tricky = wingetFiles(config, releaseManifest('v1.0.0', 'Fixed: "a" crash # one.\n\nSecond.'), 'v1.0.0');
    const text = tricky[`${folder}/XrxcGH.OpenNote.locale.en-US.yaml`];
    expect(text).toContain('ReleaseNotes: |-\n  Fixed: "a" crash # one.\n\n  Second.\n');
    expect(text).toContain('ReleaseNotesUrl: https://github.com/XrxcGH/OpenNote/releases/tag/v1.0.0');
  });

  it('ends every file with a line break and uses no tabs', () => {
    for (const text of Object.values(files)) {
      expect(text.endsWith('\n')).toBe(true);
      expect(text).not.toContain('\t');
    }
  });

  it('refuses a prerelease, a manifest with a missing architecture, and bad package details', () => {
    expect(() => wingetFiles(config, releaseManifest('v1.0.0-beta.1'), 'v1.0.0-beta.1')).toThrow('prerelease');
    const missing = structuredClone(manifest);
    delete missing.platforms['windows-i686'];
    expect(() => wingetFiles(config, missing, 'v1.0.0')).toThrow('no entry for windows-i686');
    expect(() => wingetFiles({ ...config, PackageIdentifier: 'OpenNote' }, manifest, 'v1.0.0')).toThrow(
      'PackageIdentifier',
    );
  });
});

describe.skipIf(!process.env.WINGET_VALIDATE)('winget validate (set WINGET_VALIDATE=1 to run it)', () => {
  it('accepts the files', () => {
    const out = mkdtempSync(join(tmpdir(), 'opennote-winget-out-'));
    dirs.push(out);
    const files = wingetFiles(config, releaseManifest('v1.0.0'), 'v1.0.0');
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(out, path)), { recursive: true });
      writeFileSync(join(out, path), text);
    }
    const folder = dirname(join(out, Object.keys(files)[0]));
    expect(execFileSync('winget', ['validate', '--manifest', folder], { encoding: 'utf8' })).toContain('succeeded');
  }, 60_000);
});
