// Writes the update manifest (latest.json, or beta.json for prerelease tags) next to OpenNote.exe.
// Usage: node app/scripts/write-manifest.ts <release-dir> <tag>
// The app reads this manifest to find, verify, and install updates (DEVELOPMENT.md section 9).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

function main(): void {
  const [dir, tag] = process.argv.slice(2);
  if (!dir || !tag) throw new Error('Usage: node app/scripts/write-manifest.ts <release-dir> <tag>');
  const exePath = join(dir, EXE);
  const exe = readFileSync(exePath);
  const sigPath = `${exePath}.sig`;
  const signature = existsSync(sigPath) ? readFileSync(sigPath, 'utf8').trim() : '';
  if (!signature) console.warn('No signature found: set TAURI_SIGNING_PRIVATE_KEY to sign updates.');
  const notes = process.env.RELEASE_NOTES ?? `OpenNote ${tag}`;
  const manifest = manifestFor(tag, exe, signature, notes, statSync(exePath).mtime.toISOString());
  const name = manifest.channel === 'beta' ? 'beta.json' : 'latest.json';
  writeFileSync(join(dir, name), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${name} for ${manifest.version} (${manifest.size} bytes).`);
}

if (process.argv[1]?.endsWith('write-manifest.ts')) main();
