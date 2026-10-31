// Copies the dmg or the AppImage that `tauri build` made into the release folder under its release name, such as
// OpenNote_macOS.dmg (ADR 0055). Tauri names the bundle after the version and architecture, so exactly one file
// with the bundle's extension must be in its folder; a second one would mean an old build was left behind.
// Usage: node app/scripts/release/collect-bundle.ts <target> <release-file> <release-dir>

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Where Tauri puts each kind of bundle, and its extension. */
const BUNDLES: Record<string, { folder: string; extension: string }> = {
  '.dmg': { folder: 'dmg', extension: '.dmg' },
  '.AppImage': { folder: 'appimage', extension: '.AppImage' },
};

/** The bundle folder and extension for a release file, or an error for a file that isn't a bundle. */
export function bundleKind(file: string): { folder: string; extension: string } {
  const kind = Object.entries(BUNDLES).find(([extension]) => file.endsWith(extension))?.[1];
  if (!kind) throw new Error(`${file} isn't a dmg or an AppImage, so no bundle makes it.`);
  return kind;
}

/** The one bundle in `targetDir`'s bundle folder for `file`. */
export function findBundle(targetDir: string, file: string): string {
  const { folder, extension } = bundleKind(file);
  const dir = join(targetDir, 'release', 'bundle', folder);
  const found = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(extension)) : [];
  if (found.length !== 1) {
    const what = found.length === 0 ? 'none' : found.join(', ');
    throw new Error(`Expected one ${extension} in ${dir}, and found ${what}. Build with tauri build --bundles first.`);
  }
  return join(dir, found[0] as string);
}

export function collectBundle(targetDir: string, file: string, releaseDir: string): string {
  const bundle = findBundle(targetDir, file);
  mkdirSync(releaseDir, { recursive: true });
  const out = join(releaseDir, file);
  copyFileSync(bundle, out);
  return out;
}

function main(): void {
  const [target, file, releaseDir] = process.argv.slice(2);
  if (!target || !file || !releaseDir) {
    throw new Error('Usage: node app/scripts/release/collect-bundle.ts <target> <release-file> <release-dir>');
  }
  const out = collectBundle(join('target', target), file, releaseDir);
  console.log(`Collected ${out}.`);
}

if (import.meta.main) main();
