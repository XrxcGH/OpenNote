// Writes SHA256SUMS.txt for the files of a release, in the format `sha256sum --check` reads, so anyone can confirm
// a download on Windows, macOS, or Linux. The app itself checks the hashes in the manifest, not this file.
// Usage: node app/scripts/release/checksums.ts <release-dir>

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CHECKSUMS_FILE = 'SHA256SUMS.txt';

/** The lines of a checksum file: a lowercase hash, two spaces, and the file name, in name order. */
export function checksumLines(dir: string, names: readonly string[]): string[] {
  return [...names].sort().map(
    (name) =>
      `${createHash('sha256')
        .update(readFileSync(join(dir, name)))
        .digest('hex')}  ${name}`,
  );
}

/** Writes the checksum file for every file in `dir` except itself, and returns how many it lists. */
export function writeChecksums(dir: string): number {
  const names = readdirSync(dir).filter((name) => name !== CHECKSUMS_FILE && statSync(join(dir, name)).isFile());
  writeFileSync(join(dir, CHECKSUMS_FILE), `${checksumLines(dir, names).join('\n')}\n`);
  return names.length;
}

function main(): void {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: node app/scripts/release/checksums.ts <release-dir>');
  console.log(`Wrote ${CHECKSUMS_FILE} for ${writeChecksums(dir)} files.`);
}

if (import.meta.main) main();
