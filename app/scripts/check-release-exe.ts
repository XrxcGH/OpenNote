// Checks each release exe before it's signed and published (ARCHITECTURE.md section 18.12). A release build must
// never accept plain HTTP or a test key. So the release build job fails for an exe with the test-endpoints marker.
// It also fails for an exe with any minisign public key that isn't one of the committed app/src-tauri/keys/*.pub.
// Usage: node app/scripts/check-release-exe.ts <exe> [<exe> ...]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** build.rs compiles this into builds with the test-endpoints feature. */
export const TEST_ENDPOINTS_MARKER = 'OPENNOTE-TEST-ENDPOINTS-BUILD';

export const KEYS_DIR = join(import.meta.dirname, '..', 'src-tauri', 'keys');

/**
 * A minisign public key line: 56 base64 characters that decode to 42 bytes starting with the algorithm "Ed", so
 * they always start with RW followed by Q, R, S, or T. The boundaries skip longer runs of letters, such as the key
 * name tables in the window library, which contain matches like MAILFORWARD... by chance.
 */
const KEY_LINE = /(?<![A-Za-z0-9+/])RW[QRST][A-Za-z0-9+/]{53}(?![A-Za-z0-9+/=])/g;

/** A .pub file as `tauri signer generate` writes it: base64 text that starts with "untrusted comment:". */
const ENCODED_PUB = /dW50cnVzdGVkIGNvbW1lbnQ6[A-Za-z0-9+/]+={0,2}/g;

/** True when a 56-character line decodes to a minisign public key: 42 bytes that start with "Ed". */
export function isPublicKey(line: string): boolean {
  const bytes = Buffer.from(line, 'base64');
  return line.length === 56 && bytes.length === 42 && bytes.subarray(0, 2).toString('latin1') === 'Ed';
}

/** The minisign public key lines in some text. */
function keyLines(text: string): string[] {
  return [...text.matchAll(KEY_LINE)].map((match) => match[0]).filter(isPublicKey);
}

/** Every minisign public key an exe contains, as plain key text or inside base64 .pub text. */
export function publicKeysIn(contents: Buffer): string[] {
  const text = contents.toString('latin1');
  const encoded = [...text.matchAll(ENCODED_PUB)].flatMap((match) =>
    keyLines(Buffer.from(match[0], 'base64').toString('latin1')),
  );
  return [...new Set([...keyLines(text), ...encoded])];
}

/** The key line of each committed .pub file. */
export function committedKeys(dir: string = KEYS_DIR): Set<string> {
  if (!existsSync(dir)) return new Set();
  const files = readdirSync(dir).filter((name) => name.endsWith('.pub'));
  return new Set(
    files.flatMap((name) => keyLines(Buffer.from(readFileSync(join(dir, name), 'utf8'), 'base64').toString())),
  );
}

/** What's wrong with an exe, one sentence each; empty when it may ship. */
export function problems(contents: Buffer, allowed: ReadonlySet<string>): string[] {
  const found: string[] = [];
  if (contents.includes(TEST_ENDPOINTS_MARKER)) {
    found.push(`It was built with the test-endpoints feature: it contains ${TEST_ENDPOINTS_MARKER}.`);
  }
  for (const key of publicKeysIn(contents)) {
    if (!allowed.has(key)) found.push(`It contains the public key ${key}, which isn't in app/src-tauri/keys.`);
  }
  return found;
}

function main(): void {
  const exes = process.argv.slice(2);
  if (exes.length === 0) throw new Error('Usage: node app/scripts/check-release-exe.ts <exe> [<exe> ...]');
  const allowed = committedKeys();
  let failed = false;
  for (const exe of exes) {
    const found = problems(readFileSync(exe), allowed);
    found.forEach((problem) => console.error(`::error::${exe}: ${problem}`));
    if (found.length === 0) console.log(`${exe} may ship: no test marker, and only the committed update keys.`);
    failed ||= found.length > 0;
  }
  if (failed) process.exitCode = 1;
}

if (import.meta.main) main();
