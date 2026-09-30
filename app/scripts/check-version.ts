// Checks that a release tag matches the version in the three version files (docs/RELEASING.md, Versioning).
// If the tag and the files differed, the app would report one version while the manifest announced another,
// so the updater would offer the same update again and again.
// Usage: node app/scripts/check-version.ts <tag>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

/** Reads `version` from the [package] table of a Cargo.toml file. */
export function cargoVersion(toml: string): string | undefined {
  let inPackage = false;
  for (const line of toml.split(/\r?\n/)) {
    const table = /^\s*\[([^\]]*)\]/.exec(line);
    if (table) inPackage = table[1].trim() === 'package';
    const version = inPackage ? /^\s*version\s*=\s*"([^"]*)"/.exec(line) : null;
    if (version) return version[1];
  }
  return undefined;
}

/** The version each file declares, keyed by its path from the repository root. */
export function versionsIn(root: string): Record<string, string | undefined> {
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  return {
    'package.json': JSON.parse(read('package.json')).version,
    'app/src-tauri/Cargo.toml': cargoVersion(read('app/src-tauri/Cargo.toml')),
    'app/src-tauri/tauri.conf.json': JSON.parse(read('app/src-tauri/tauri.conf.json')).version,
  };
}

/** Describes each file whose version differs from the tag without its leading `v`. */
export function mismatches(tag: string, versions: Record<string, string | undefined>): string[] {
  const expected = tag.replace(/^v/, '');
  return Object.entries(versions)
    .filter(([, version]) => version !== expected)
    .map(([path, version]) => `${path} has ${version ?? 'no version'}, but the tag ${tag} needs ${expected}.`);
}

function main(): void {
  const tag = process.argv[2];
  if (!tag) throw new Error('Usage: node app/scripts/check-version.ts <tag>');
  const problems = mismatches(tag, versionsIn(ROOT));
  // GitHub Actions turns ::error:: lines on standard output into annotations on the run.
  problems.forEach((problem) => console.log(`::error::${problem}`));
  if (problems.length > 0) {
    console.error('Bump all three version files to match the tag. See docs/RELEASING.md, Versioning.');
    process.exitCode = 1;
    return;
  }
  console.log(`The tag ${tag} matches all three version files.`);
}

if (import.meta.main) main();
