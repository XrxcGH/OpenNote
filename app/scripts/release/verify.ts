// Checks a finished release folder the way a running copy of OpenNote will. It checks the manifest, then each exe's
// size, hash, and signature (docs/RELEASING.md, Verifying a release). The release workflow runs it before anything
// is published, so a release that the updater would refuse never goes out.
// Usage: node app/scripts/release/verify.ts <release-dir> <tag> [--pubkey <file>]... [--require-authenticode]
// Without --pubkey it trusts the keys committed in app/src-tauri/keys, which are the keys built into the app.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, RELEASE_FILES, versionOf, type Manifest, type ReleaseFile } from '../write-manifest.ts';
import { onlyField, parsePublicKey, parseSignature, verifyWithAny, type PublicKey } from './minisign.ts';
import { hasAuthenticode, windowsSignatureStatus } from './pe.ts';

/** The limits the updater enforces (crates/updater/src/config.rs and manifest.rs). */
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_EXE_BYTES = 200 * 1024 * 1024;
export const MAX_NOTES_BYTES = 4096;

export const KEYS_DIR = join(import.meta.dirname, '..', '..', 'src-tauri', 'keys');

export interface VerifyOptions {
  dir: string;
  tag: string;
  /** The public keys the app trusts. The signature on every exe must verify with one of them. */
  keys: readonly PublicKey[];
  /** Also require an Authenticode signature on every exe. */
  requireAuthenticode?: boolean;
  files?: readonly ReleaseFile[];
  /** Asks the operating system about a signature. Tests replace it, because PowerShell takes seconds to start. */
  windowsStatus?: (path: string) => string | undefined;
}

/** The keys in the `.pub` files of a folder, in file-name order. A missing folder has none. */
export function keysIn(dir: string = KEYS_DIR): PublicKey[] {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter((name) => name.endsWith('.pub'));
  return names.sort().map((name) => parsePublicKey(readFileSync(join(dir, name), 'utf8')));
}

/** Which manifest file a version goes in: beta.json for a prerelease, latest.json otherwise. */
export function manifestName(version: string): string {
  return version.includes('-') ? 'beta.json' : 'latest.json';
}

function readManifest(dir: string, name: string, problems: string[]): Manifest | undefined {
  const path = join(dir, name);
  if (!existsSync(path)) {
    problems.push(`${name} is missing.`);
    return undefined;
  }
  if (statSync(path).size > MAX_MANIFEST_BYTES) problems.push(`${name} is larger than ${MAX_MANIFEST_BYTES} bytes.`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  } catch {
    problems.push(`${name} is not valid JSON.`);
    return undefined;
  }
}

function manifestProblems(manifest: Manifest, name: string, tag: string, files: readonly ReleaseFile[]): string[] {
  const problems: string[] = [];
  const version = versionOf(tag);
  if (manifest.version !== version) problems.push(`${name} has version ${manifest.version}, but the tag is ${tag}.`);
  const channel = version.includes('-') ? 'beta' : 'stable';
  if (manifest.channel !== channel)
    problems.push(`${name} has channel ${manifest.channel}, but ${version} is ${channel}.`);
  if (Number.isNaN(Date.parse(manifest.pub_date))) problems.push(`${name} has no valid pub_date.`);
  const notes = manifest.notes ?? '';
  if (notes.trim() === '') problems.push(`${name} has no release notes.`);
  if (Buffer.byteLength(notes) > MAX_NOTES_BYTES)
    problems.push(`The notes in ${name} are longer than ${MAX_NOTES_BYTES} bytes.`);
  const expected = files.map(({ platform }) => platform).sort();
  const found = Object.keys(manifest.platforms ?? {}).sort();
  if (expected.join() !== found.join())
    problems.push(`${name} lists ${found.join(', ')}, but a release has ${expected.join(', ')}.`);
  return problems;
}

/** Everything wrong with one exe and its manifest entry; empty when a copy of the app would accept it. */
function fileProblems(
  options: VerifyOptions,
  manifest: Manifest | undefined,
  { platform, file }: ReleaseFile,
): string[] {
  const path = join(options.dir, file);
  if (!existsSync(path) || statSync(path).size === 0) return [`${file} is missing or empty.`];
  const exe = readFileSync(path);
  const problems: string[] = [];
  if (exe.length > MAX_EXE_BYTES)
    problems.push(`${file} is larger than ${MAX_EXE_BYTES} bytes, so the app would refuse it.`);
  problems.push(...signatureProblems(options, file, exe));
  const entry = manifest?.platforms?.[platform];
  if (manifest && !entry) return [...problems, `The manifest has no entry for ${platform}.`];
  if (entry) problems.push(...entryProblems(options, file, exe, entry));
  if (options.requireAuthenticode) problems.push(...authenticodeProblems(options, path, file, exe));
  return problems;
}

function entryProblems(
  options: VerifyOptions,
  file: string,
  exe: Buffer,
  entry: Manifest['platforms'][string],
): string[] {
  const problems: string[] = [];
  const url = `https://github.com/${REPO}/releases/download/${options.tag}/${file}`;
  if (entry.url !== url) problems.push(`The manifest sends ${file} to ${entry.url}, not ${url}.`);
  if (entry.size !== exe.length)
    problems.push(`The manifest says ${file} is ${entry.size} bytes, but it is ${exe.length}.`);
  if (entry.sha256 !== createHash('sha256').update(exe).digest('hex'))
    problems.push(`The manifest's SHA-256 for ${file} does not match the file.`);
  const sigPath = join(options.dir, `${file}.sig`);
  const sig = existsSync(sigPath) ? readFileSync(sigPath, 'utf8').trim() : '';
  if (entry.signature.trim() !== sig) problems.push(`The manifest's signature for ${file} differs from ${file}.sig.`);
  return problems;
}

function signatureProblems(options: VerifyOptions, file: string, exe: Buffer): string[] {
  const sigPath = join(options.dir, `${file}.sig`);
  if (!existsSync(sigPath)) return [`${file}.sig is missing.`];
  if (options.keys.length === 0) return ['There is no update key to check the signatures against.'];
  try {
    const comment = verifyWithAny(exe, parseSignature(readFileSync(sigPath, 'utf8')), options.keys);
    const problems: string[] = [];
    const version = versionOf(options.tag);
    if (onlyField(comment, 'version') !== version)
      problems.push(`The signature of ${file} does not name version ${version} exactly once.`);
    if (onlyField(comment, 'file') !== file)
      problems.push(`The signature of ${file} does not name the file ${file} exactly once.`);
    return problems;
  } catch (error) {
    return [`${file}: ${(error as Error).message}`];
  }
}

function authenticodeProblems(options: VerifyOptions, path: string, file: string, exe: Buffer): string[] {
  if (!hasAuthenticode(exe)) {
    return [`${file} has no Authenticode signature. See docs/RELEASING.md, Add code signing later.`];
  }
  const status = (options.windowsStatus ?? windowsSignatureStatus)(path);
  return status === undefined || status === 'Valid'
    ? []
    : [`Windows says the Authenticode signature of ${file} is ${status}.`];
}

/** Checks a release folder against a tag. It returns one sentence for each problem, and nothing when all is well. */
export function verifyRelease(options: VerifyOptions): string[] {
  const files = options.files ?? RELEASE_FILES;
  const name = manifestName(versionOf(options.tag));
  const other = name === 'beta.json' ? 'latest.json' : 'beta.json';
  const problems: string[] = [];
  if (existsSync(join(options.dir, other)))
    problems.push(`${other} must not be in a ${name === 'beta.json' ? 'prerelease' : 'stable release'}.`);
  const manifest = readManifest(options.dir, name, problems);
  if (manifest) problems.push(...manifestProblems(manifest, name, options.tag, files));
  for (const file of files) problems.push(...fileProblems(options, manifest, file));
  return problems;
}

function main(): void {
  const args = process.argv.slice(2);
  const [dir, tag] = args.filter((arg, at) => !arg.startsWith('--') && args[at - 1] !== '--pubkey');
  if (!dir || !tag)
    throw new Error('Usage: node app/scripts/release/verify.ts <release-dir> <tag> [--pubkey <file>]...');
  const pubkeys = args.flatMap((arg, at) => (args[at - 1] === '--pubkey' ? [arg] : []));
  const keys = pubkeys.length > 0 ? pubkeys.map((path) => parsePublicKey(readFileSync(path, 'utf8'))) : keysIn();
  const requireAuthenticode = args.includes('--require-authenticode');
  const problems = verifyRelease({ dir, tag, keys, requireAuthenticode });
  problems.forEach((problem) => console.log(`::error::${problem}`));
  if (problems.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `The release in ${dir} is what the app's updater accepts for ${tag}: ${RELEASE_FILES.length} signed exes.`,
  );
}

if (import.meta.main) main();
