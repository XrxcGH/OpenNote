// Writes the update manifest (latest.json, or beta.json for prerelease tags) next to OpenNote.exe.
// Usage: node app/scripts/write-manifest.ts <release-dir> <tag>
// The app reads this manifest to find, verify, and install updates (DEVELOPMENT.md section 9).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'XrxcGH/OpenNote';
const EXE = 'OpenNote.exe';

export interface Manifest {
  version: string;
  channel: 'stable' | 'beta';
  notes: string;
  pub_date: string;
  url: string;
  size: number;
  sha256: string;
  signature: string;
}

export function manifestFor(tag: string, exe: Buffer, signature: string, notes: string, date: string): Manifest {
  const version = tag.replace(/^v/, '');
  return {
    version,
    channel: version.includes('-') ? 'beta' : 'stable',
    notes,
    pub_date: date,
    url: `https://github.com/${REPO}/releases/download/${tag}/${EXE}`,
    size: exe.length,
    sha256: createHash('sha256').update(exe).digest('hex'),
    signature,
  };
}

/** Stable copies read only latest.json, so a beta goes to beta.json. */
export function manifestFile(manifest: Manifest): string {
  return manifest.channel === 'beta' ? 'beta.json' : 'latest.json';
}

/** Reads the .sig file that `tauri signer sign` writes. A release is never published unsigned. */
export function readSignature(sigPath: string): string {
  const signature = existsSync(sigPath) ? readFileSync(sigPath, 'utf8').trim() : '';
  if (!signature) throw new Error(`No signature found at ${sigPath}. Sign the exe with tauri signer sign first.`);
  return signature;
}

/**
 * Throws unless the signature's trusted comment names `version`. The signature covers that comment,
 * so the version can't be changed without the private key. The .sig file is a base64-encoded minisign
 * signature whose trusted comment reads `timestamp:<seconds>\tfile:<name>\tversion:<version>`.
 */
export function checkSignedVersion(signature: string, version: string): void {
  const lines = Buffer.from(signature, 'base64').toString('utf8').split(/\r?\n/);
  const comment = lines.find((line) => line.startsWith('trusted comment: '));
  if (comment === undefined) throw new Error('The signature has no trusted comment, so it is not a Tauri signature.');
  const fields = comment.slice('trusted comment: '.length).split('\t');
  const signed = fields.find((field) => field.startsWith('version:'))?.slice('version:'.length);
  if (signed !== version) {
    const found = signed === undefined ? 'no version' : `version ${signed}`;
    throw new Error(`The signature names ${found}, but the tag is for ${version}. Sign with --app-version ${version}.`);
  }
}

function main(): void {
  const [dir, tag] = process.argv.slice(2);
  if (!dir || !tag) throw new Error('Usage: node app/scripts/write-manifest.ts <release-dir> <tag>');
  const exePath = join(dir, EXE);
  const exe = readFileSync(exePath);
  const signature = readSignature(`${exePath}.sig`);
  const notes = process.env.RELEASE_NOTES ?? `OpenNote ${tag}`;
  const manifest = manifestFor(tag, exe, signature, notes, new Date().toISOString());
  checkSignedVersion(signature, manifest.version);
  const name = manifestFile(manifest);
  writeFileSync(join(dir, name), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${name} for ${manifest.version} (${manifest.size} bytes).`);
}

if (import.meta.main) main();
