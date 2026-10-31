// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bundleKind, collectBundle, findBundle } from './collect-bundle.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function targetWith(folder: string, names: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-bundle-'));
  dirs.push(dir);
  const bundles = join(dir, 'release', 'bundle', folder);
  mkdirSync(bundles, { recursive: true });
  for (const name of names) writeFileSync(join(bundles, name), name);
  return dir;
}

describe('collecting a bundle', () => {
  it('knows where Tauri puts a dmg and an AppImage', () => {
    expect(bundleKind('OpenNote_macOS.dmg')).toEqual({ folder: 'dmg', extension: '.dmg' });
    expect(bundleKind('OpenNote_Linux.AppImage')).toEqual({ folder: 'appimage', extension: '.AppImage' });
    expect(() => bundleKind('OpenNote_Windows64.exe')).toThrow("isn't a dmg or an AppImage");
  });

  it('copies the one bundle under its release name', () => {
    const target = targetWith('appimage', ['OpenNote_0.1.0_amd64.AppImage', 'build.log']);
    const out = collectBundle(target, 'OpenNote_Linux.AppImage', join(target, 'dist-release'));
    expect(out).toBe(join(target, 'dist-release', 'OpenNote_Linux.AppImage'));
    expect(readFileSync(out, 'utf8')).toBe('OpenNote_0.1.0_amd64.AppImage');
  });

  it('refuses a folder with no bundle or with two', () => {
    expect(() => findBundle(targetWith('dmg', []), 'OpenNote_macOS.dmg')).toThrow('found none');
    const two = targetWith('dmg', ['OpenNote_0.1.0_universal.dmg', 'OpenNote_0.0.9_universal.dmg']);
    expect(() => findBundle(two, 'OpenNote_macOS.dmg')).toThrow('OpenNote_0.0.9_universal.dmg');
  });
});
