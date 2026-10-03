// Checks the files the package job downloaded, before it signs anything (docs/RELEASING.md, The package job).
// Any job in a run can upload an artifact, including the CI jobs. Their actions and test tools come from outside
// this repository. So the package job signs only the exes the build job made, byte for byte, and nothing else.
//
// Usage: node app/scripts/release/check-downloads.ts <release-dir>
// BUILD_SHA256 holds the build job's outputs as JSON, with a "sha256-<rust target>" entry for each exe.
// SBOM_SHA256 holds the sbom job's hash of the bill of materials.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { committedKeys, problems as exeProblems } from '../check-release-exe.ts';
import { RELEASE_FILES, type ReleaseFile } from '../write-manifest.ts';

/** The bill of materials that the sbom job writes. */
export const SBOM_FILE = 'OpenNote.sbom.cdx.json';

/** The build job's output that holds the SHA-256 of the exe built for a Rust target. */
export const hashOutput = (target: string): string => `sha256-${target}`;

/** The hashes the jobs reported for the files they made, as lowercase hexadecimal. */
export interface Expected {
  /** The build job's outputs, with a SHA-256 under `hashOutput(target)` for each exe. */
  readonly build: Readonly<Record<string, unknown>>;
  /** The sbom job's SHA-256 of the bill of materials. */
  readonly sbom: string | undefined;
}

export interface CheckOptions {
  /** The exes the release ships. Defaults to app/release-files.json. */
  readonly files?: readonly ReleaseFile[];
  /** The update keys an exe may hold. Defaults to the committed app/src-tauri/keys. */
  readonly keys?: ReadonlySet<string>;
}

const SHA256 = /^[0-9a-f]{64}$/;

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * What's wrong with the downloaded folder, one sentence each; empty when it holds exactly the files the jobs made.
 * Reads files.
 */
export function downloadProblems(dir: string, expected: Expected, options: CheckOptions = {}): string[] {
  const files = options.files ?? RELEASE_FILES;
  const keys = options.keys ?? committedKeys();
  const wanted = new Map<string, { hash: unknown; exe: boolean }>([
    ...files.map(({ target, file }) => [file, { hash: expected.build[hashOutput(target)], exe: true }] as const),
    [SBOM_FILE, { hash: expected.sbom, exe: false }],
  ]);
  const found = readdirSync(dir)
    .filter((name) => !wanted.has(name))
    .sort()
    // Quoted, so a strange name can't start a workflow command of its own in the log.
    .map((name) => `${JSON.stringify(name)} isn't a release file, so no job of the release may add it.`);
  for (const [name, { hash, exe }] of wanted) {
    const path = join(dir, name);
    if (!isFile(path)) {
      found.push(`${name} is missing.`);
      continue;
    }
    if (typeof hash !== 'string' || !SHA256.test(hash)) {
      found.push(`The job that makes ${name} reported no SHA-256 for it.`);
      continue;
    }
    const contents = readFileSync(path);
    const actual = createHash('sha256').update(contents).digest('hex');
    if (actual !== hash) {
      found.push(`${name} isn't the file its job made: its SHA-256 is ${actual}, not ${hash}.`);
    } else if (exe) {
      found.push(...exeProblems(contents, keys).map((problem) => `${name}: ${problem}`));
    }
  }
  return found;
}

/** The hashes from the variables the package job sets. */
export function expectedFrom(env: Readonly<Record<string, string | undefined>>): Expected {
  if (env.BUILD_SHA256 === undefined) throw new Error('BUILD_SHA256 is not set.');
  const build: unknown = JSON.parse(env.BUILD_SHA256);
  if (typeof build !== 'object' || build === null || Array.isArray(build)) {
    throw new Error('BUILD_SHA256 must be a JSON object of the build job outputs.');
  }
  return { build: build as Record<string, unknown>, sbom: env.SBOM_SHA256 };
}

function main(): void {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: node app/scripts/release/check-downloads.ts <release-dir>');
  const found = downloadProblems(dir, expectedFrom(process.env));
  found.forEach((problem) => console.error(`::error::${problem}`));
  if (found.length > 0) process.exitCode = 1;
  else
    console.log(
      `${dir} holds the ${RELEASE_FILES.length} exes and the bill of materials the jobs made, and nothing else.`,
    );
}

if (import.meta.main) main();
