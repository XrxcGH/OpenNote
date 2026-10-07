// The update-from-earlier-beta test. A copy of the updater's test app (crates/updater/examples/fake_app.rs), built
// from the last beta tag, updates itself to the release in a folder, the way a beta tester's copy will: it reads the
// manifest, downloads its exe, checks the hash and the signature, swaps the exe, and starts the new one. The files
// are served from 127.0.0.1, which only test builds of the updater accept, with each URL in the manifest pointing
// there. The release workflow runs it after the package job, for a dry run with the throwaway key and for a tag
// with the committed key.
//
// Usage:
//   node app/scripts/release/update-test.ts earlier <tag>
//     Prints the last beta tag before <tag>, or nothing when there is none.
//   node app/scripts/release/update-test.ts run <release-dir> <tag> --fake-app <exe> --from <version>
//                                              [--pubkey <file>] [--report <file>]
//     Without --pubkey it trusts the first key committed in app/src-tauri/keys.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RELEASE_FILES, versionOf, type Manifest } from '../write-manifest.ts';
import { KEYS_DIR } from './verify.ts';
import { compareVersions } from './versions.ts';

/** What the test app appends to a copy of itself to say which version it is. */
export const TRAILER = '#fake-app-version:';

/** How long the test waits for the swap. A cold exe download and signature check take seconds. */
export const WAIT_MS = 120_000;

/** The last `v*-beta.*` tag below `tag`, or undefined when there is none. */
export function earlierBeta(tags: readonly string[], tag: string): string | undefined {
  const current = versionOf(tag);
  const betas = tags
    .map((each) => each.trim())
    .filter((each) => /^v\d+\.\d+\.\d+-beta\.\d+$/.test(each))
    .filter((each) => compareVersions(versionOf(each), current) < 0)
    .sort((a, b) => compareVersions(versionOf(b), versionOf(a)));
  return betas[0];
}

/** The manifest with each file's URL on the local server. Everything the updater checks stays the same. */
export function localManifest(manifest: Manifest, base: string): Manifest {
  const platforms = Object.fromEntries(
    Object.entries(manifest.platforms).map(([key, entry]) => {
      const file = entry.url.slice(entry.url.lastIndexOf('/') + 1);
      return [key, { ...entry, url: `${base}/${encodeURIComponent(file)}` }];
    }),
  );
  return { ...manifest, platforms };
}

/** A copy of the test app's exe that says it is `version`. */
export function withTrailer(exe: Buffer, version: string): Buffer {
  return Buffer.concat([exe, Buffer.from(`${TRAILER}${version}`)]);
}

/** The minisign public key text in a `.pub` file as `tauri signer generate` writes it (base64 of the text). */
export function decodePubFile(contents: string): string {
  const text = Buffer.from(contents.trim(), 'base64').toString('utf8');
  if (!text.startsWith('untrusted comment:')) throw new Error('The .pub file does not hold a minisign public key.');
  return text;
}

/** Whether the test app's event log says it applied `from` to `to`. */
export function appliedIn(events: string, from: string, to: string): boolean {
  return events.split(/\r?\n/).some((line) => line.trim() === `applied ${from} ${to}`);
}

/** The reason the update failed, from the test app's event log, if it says. */
export function failureIn(events: string): string | undefined {
  return events
    .split(/\r?\n/)
    .find((line) => line.startsWith('update failure detail:') || line.startsWith('update failed'));
}

/** Serves the manifest and the release's files, and nothing else, from 127.0.0.1. */
function serve(dir: string): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const name = decodeURIComponent((request.url ?? '/').slice(1));
      if (request.method !== 'GET' || !readdirSync(dir).includes(name)) {
        response.writeHead(404).end();
        return;
      }
      const body = readFileSync(join(dir, name));
      response.writeHead(200, { 'Content-Length': body.length }).end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

export interface RunOptions {
  dir: string;
  tag: string;
  fakeApp: string;
  from: string;
  pubkeyText: string;
}

export interface Report {
  from: string;
  to: string;
  file: string;
  ok: boolean;
  detail: string;
}

/** Runs the test and returns what happened. The new exe it starts is stopped at the end. */
export async function runUpdateTest(options: RunOptions): Promise<Report> {
  const to = versionOf(options.tag);
  const release = RELEASE_FILES.find((each) => each.target === 'x86_64-pc-windows-msvc');
  if (!release) throw new Error('No x64 file in app/release-files.json.');
  const manifestName = to.includes('-') ? 'beta.json' : 'latest.json';
  const manifest = JSON.parse(readFileSync(join(options.dir, manifestName), 'utf8')) as Manifest;
  const work = mkdtempSync(join(tmpdir(), 'opennote-update-test-'));
  const served = join(work, 'served');
  const app = join(work, 'app');
  for (const folder of [served, app]) mkdirSync(folder, { recursive: true });
  copyFileSync(join(options.dir, release.file), join(served, release.file));
  const { server, base } = await serve(served);
  writeFileSync(join(served, manifestName), JSON.stringify(localManifest(manifest, base)));
  const exe = join(app, 'OpenNote-update-test.exe');
  writeFileSync(exe, withTrailer(readFileSync(options.fakeApp), options.from));
  const env = {
    ...process.env,
    FAKE_APP_DIR: work,
    FAKE_APP_PUBKEY: options.pubkeyText,
    // The new exe the test app starts keeps its files in the test folder, not the runner's profile.
    OPENNOTE_PROFILE_DIR: join(work, 'profile'),
  };
  spawn(exe, ['update', `${base}/${manifestName}`], { env, stdio: 'ignore' }).unref();
  const events = join(work, 'events.log');
  const deadline = Date.now() + WAIT_MS;
  let log = '';
  while (Date.now() < deadline) {
    log = existsSync(events) ? readFileSync(events, 'utf8') : '';
    if (appliedIn(log, options.from, to) || failureIn(log)) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  server.close();
  spawnSync('taskkill', ['/F', '/T', '/IM', 'OpenNote-update-test.exe'], { stdio: 'ignore' });
  const want = createHash('sha256')
    .update(readFileSync(join(options.dir, release.file)))
    .digest('hex');
  const got = existsSync(exe) ? createHash('sha256').update(readFileSync(exe)).digest('hex') : '';
  const applied = appliedIn(log, options.from, to);
  const ok = applied && got === want;
  const detail = ok
    ? `${options.from} updated itself to ${to}, and its exe is now ${release.file}.`
    : (failureIn(log) ??
      (applied ? 'The swap reported success, but the exe is not the release file.' : 'The update timed out.'));
  return { from: options.from, to, file: release.file, ok, detail };
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'earlier') {
    const tags = spawnSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).stdout.split('\n');
    console.log(earlierBeta(tags, args[0] ?? '') ?? '');
    return;
  }
  if (command !== 'run' || args.length < 2) {
    throw new Error(
      'Usage: node app/scripts/release/update-test.ts run <release-dir> <tag> --fake-app <exe> --from <version>',
    );
  }
  const [dir, tag] = args;
  const fakeApp = option(args, '--fake-app');
  const from = option(args, '--from');
  if (!fakeApp || !from) throw new Error('--fake-app and --from are needed.');
  const pubkey = option(args, '--pubkey');
  const pubFile = pubkey ?? readdirSync(KEYS_DIR).find((name) => name.endsWith('.pub'));
  if (!pubFile) throw new Error('No --pubkey, and no key committed in app/src-tauri/keys.');
  const pubkeyText = decodePubFile(readFileSync(pubkey ?? join(KEYS_DIR, pubFile), 'utf8'));
  const report = await runUpdateTest({ dir, tag, fakeApp, from, pubkeyText });
  console.log(report.detail);
  const reportFile = option(args, '--report');
  if (reportFile) writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.main) await main();
