// Signs the release exes for the updater with the Tauri command-line tool, one `.sig` file next to each exe.
// A real run reads the private key from TAURI_SIGNING_PRIVATE_KEY, and stops if it isn't set, so a release is never
// published unsigned. A dry run ignores that key, makes a throwaway one, and writes its public half for verify.ts.
// Usage: node app/scripts/release/sign.ts <release-dir> <tag> [--dry-run --pubkey-out <file>]

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { RELEASE_FILES, versionOf, type ReleaseFile } from '../write-manifest.ts';

const TAURI_CLI = join(import.meta.dirname, '..', '..', '..', 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const KEY_VARIABLES = [
  'TAURI_SIGNING_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY_PATH',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
];

/** Runs `tauri <args>` with exactly this environment. Tests replace it so they need no private key. */
export type Tauri = (args: string[], env: Record<string, string>) => void;

export interface SignOptions {
  dir: string;
  tag: string;
  env: Record<string, string | undefined>;
  dryRun?: boolean;
  /** Where a dry run writes the throwaway public key. */
  pubkeyOut?: string;
  files?: readonly ReleaseFile[];
  tauri?: Tauri;
}

/** Calls the Tauri command-line tool that `npm ci` installed, without a shell, so no argument can be misread. */
export const runTauri: Tauri = (args, env) => {
  execFileSync(process.execPath, [TAURI_CLI, ...args], { env, stdio: ['ignore', 'inherit', 'inherit'] });
};

/** The environment for the Tauri tool: this one's, minus every signing variable, so no key leaks into a dry run. */
function plainEnvironment(env: SignOptions['env']): Record<string, string> {
  const entries = Object.entries(env).filter(([name, value]) => value !== undefined && !KEY_VARIABLES.includes(name));
  return Object.fromEntries(entries) as Record<string, string>;
}

function signAll(options: SignOptions, signingEnv: Record<string, string>): void {
  const tauri = options.tauri ?? runTauri;
  const version = versionOf(options.tag);
  for (const { file } of options.files ?? RELEASE_FILES) {
    const path = join(options.dir, file);
    if (!existsSync(path) || statSync(path).size === 0)
      throw new Error(`There is no ${file} to sign in ${options.dir}.`);
    // --app-version puts the version in the signed trusted comment, so nobody can change it later.
    tauri(['signer', 'sign', '--app-version', version, path], signingEnv);
    if (!existsSync(`${path}.sig`)) throw new Error(`The Tauri tool did not write ${file}.sig.`);
  }
}

/** Signs with the key in the environment. Only the signing step of the release workflow should have it. */
function signWithSecret(options: SignOptions): void {
  const key = options.env.TAURI_SIGNING_PRIVATE_KEY;
  if (!key) throw new Error('The TAURI_SIGNING_PRIVATE_KEY secret is not set. See docs/RELEASING.md.');
  const signingEnv = { ...plainEnvironment(options.env), TAURI_SIGNING_PRIVATE_KEY: key };
  const password = options.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  signAll(
    options,
    password === undefined ? signingEnv : { ...signingEnv, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password },
  );
}

/** Makes a key that exists for this run only, signs with it, and keeps just its public half. */
function signWithThrowawayKey(options: SignOptions): void {
  if (!options.pubkeyOut) throw new Error('A dry run needs --pubkey-out, so the signatures can be checked.');
  const tauri = options.tauri ?? runTauri;
  const folder = mkdtempSync(join(tmpdir(), 'opennote-dry-run-'));
  try {
    const password = randomBytes(24).toString('hex');
    const keyPath = join(folder, 'dry-run.key');
    const env = plainEnvironment(options.env);
    tauri(['signer', 'generate', '--ci', '--password', password, '--write-keys', keyPath], env);
    const signingEnv = {
      ...env,
      TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyPath, 'utf8'),
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
    };
    signAll(options, signingEnv);
    mkdirSync(dirname(options.pubkeyOut), { recursive: true });
    copyFileSync(`${keyPath}.pub`, options.pubkeyOut);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Signs every release file. See the top of this file for the real and dry-run modes. */
export function signRelease(options: SignOptions): void {
  if (options.dryRun) signWithThrowawayKey(options);
  else signWithSecret(options);
}

function main(): void {
  const args = process.argv.slice(2);
  const [dir, tag] = args.filter((arg, at) => !arg.startsWith('--') && args[at - 1] !== '--pubkey-out');
  if (!dir || !tag)
    throw new Error('Usage: node app/scripts/release/sign.ts <release-dir> <tag> [--dry-run --pubkey-out <file>]');
  const at = args.indexOf('--pubkey-out');
  const pubkeyOut = at === -1 ? undefined : args[at + 1];
  signRelease({ dir, tag, env: process.env, dryRun: args.includes('--dry-run'), pubkeyOut });
  console.log(
    `Signed ${RELEASE_FILES.length} exes for ${tag}${args.includes('--dry-run') ? ' with a throwaway key' : ''}.`,
  );
}

if (import.meta.main) main();
