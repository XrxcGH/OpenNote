// Writes the update manifest (latest.json, or beta.json for prerelease tags) next to the release files.
// Usage: node app/scripts/write-manifest.ts <release-dir> <tag>
// The app reads this manifest to find, verify, and install the update for its platform (docs/DEVELOPMENT.md section 9).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'XrxcGH/OpenNote';

/** One file a release ships: the Tauri updater's platform key, the Rust target it's built for, and its name. */
export interface ReleaseFile {
  readonly platform: string;
  readonly target: string;
  readonly file: string;
}

/**
 * Every file a release ships, from app/release-files.json. The updater crate embeds the same table, and the build
 * matrix in .github/workflows/release.yml builds the same files; tests check both. Later, macOS will ship
 * OpenNote_macOS.dmg, and Linux will ship OpenNote_Linux.AppImage.
 */
export const RELEASE_FILES: readonly ReleaseFile[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'release-files.json'), 'utf8'),
);

/** One file in the manifest. The updater downloads `url`, then checks `size`, `sha256`, and `signature`. */
export interface PlatformEntry {
  url: string;
  signature: string;
  size: number;
  sha256: string;
}

/** The Tauri updater's multi-platform format, plus the channel. Each copy reads its own platform key. */
export interface Manifest {
  version: string;
  notes: string;
  pub_date: string;
  channel: 'stable' | 'beta';
  platforms: Record<string, PlatformEntry>;
}

/** The version a tag names, without its leading `v`. */
export function versionOf(tag: string): string {
  return tag.replace(/^v/, '');
}

export function platformEntry(tag: string, file: string, contents: Buffer, signature: string): PlatformEntry {
  return {
    url: `https://github.com/${REPO}/releases/download/${tag}/${file}`,
    signature,
    size: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

export function manifestFor(
  tag: string,
  platforms: Record<string, PlatformEntry>,
  notes: string,
  date: string,
): Manifest {
  const version = versionOf(tag);
  const channel = version.includes('-') ? 'beta' : 'stable';
  return { version, notes, pub_date: date, channel, platforms };
}

/** Stable copies read only latest.json, so a beta goes to beta.json. */
export function manifestFile(manifest: Manifest): string {
  return manifest.channel === 'beta' ? 'beta.json' : 'latest.json';
}

/** Reads a release file that the build job made. A missing or empty file stops the release. */
export function readReleaseFile(path: string): Buffer {
  const contents = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
  if (contents.length === 0) throw new Error(`No release file found at ${path}. The build job makes one per target.`);
  return contents;
}

/** Reads the .sig file that `tauri signer sign` writes. A release is never published unsigned. */
export function readSignature(sigPath: string): string {
  const signature = existsSync(sigPath) ? readFileSync(sigPath, 'utf8').trim() : '';
  if (!signature) throw new Error(`No signature found at ${sigPath}. Sign each file with tauri signer sign first.`);
  return signature;
}

/** The `key:value` fields of a Tauri signature's trusted comment, or null when it has none. */
export function signedFields(signature: string): Map<string, string> | null {
  const lines = Buffer.from(signature, 'base64').toString('utf8').split(/\r?\n/);
  const comment = lines.find((line) => line.startsWith('trusted comment: '));
  if (comment === undefined) return null;
  const fields = comment.slice('trusted comment: '.length).split('\t');
  return new Map(fields.map((field) => [field.slice(0, field.indexOf(':')), field.slice(field.indexOf(':') + 1)]));
}

/**
 * Throws unless the signature of `file` has a trusted comment that names `version` and `file`. The signature covers
 * that comment, so neither can change without the private key. The updater checks both. So an old signed file
 * can't pass as new, and one architecture's file can't pass as another's. The .sig file is a base64-encoded minisign
 * signature whose trusted comment reads `timestamp:<seconds>\tfile:<name>\tversion:<version>`.
 */
export function checkSignedComment(signature: string, version: string, file: string): void {
  const fields = signedFields(signature);
  const what = `The signature of ${file}`;
  if (fields === null) throw new Error(`${what} has no trusted comment, so it isn't a Tauri signature.`);
  const signed = fields.get('version');
  if (signed !== version) {
    const found = signed === undefined ? 'no version' : `version ${signed}`;
    throw new Error(`${what} names ${found}, but the tag is for ${version}. Sign with --app-version ${version}.`);
  }
  const signedFile = fields.get('file');
  if (signedFile !== file) {
    const found = signedFile === undefined ? 'no file' : `the file ${signedFile}`;
    throw new Error(`${what} names ${found}. Rename the exe to ${file} before signing it.`);
  }
}

/** Reads and checks every file in RELEASE_FILES, and describes each one under its platform key. */
export function readPlatforms(dir: string, tag: string): Record<string, PlatformEntry> {
  const platforms: Record<string, PlatformEntry> = {};
  for (const { platform, file } of RELEASE_FILES) {
    const contents = readReleaseFile(join(dir, file));
    const signature = readSignature(join(dir, `${file}.sig`));
    checkSignedComment(signature, versionOf(tag), file);
    platforms[platform] = platformEntry(tag, file, contents, signature);
  }
  return platforms;
}

/** Writes the manifest for `tag` into `dir`, and returns it with the name of the file it wrote. */
export function writeManifest(
  dir: string,
  tag: string,
  notes: string,
  date: string,
): { name: string; manifest: Manifest } {
  const manifest = manifestFor(tag, readPlatforms(dir, tag), notes, date);
  const name = manifestFile(manifest);
  writeFileSync(join(dir, name), `${JSON.stringify(manifest, null, 2)}\n`);
  return { name, manifest };
}

function main(): void {
  const [dir, tag] = process.argv.slice(2);
  if (!dir || !tag) throw new Error('Usage: node app/scripts/write-manifest.ts <release-dir> <tag>');
  const notes = process.env.RELEASE_NOTES ?? `OpenNote ${tag}`;
  const { name, manifest } = writeManifest(dir, tag, notes, new Date().toISOString());
  const files = Object.keys(manifest.platforms).length;
  console.log(`Wrote ${name} for ${manifest.version}, with ${files} files.`);
}

if (import.meta.main) main();
