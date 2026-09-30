// Drives the real app end to end (ARCHITECTURE.md section 21.5). Each session starts tauri-driver with the
// msedgedriver that matches the WebView2 Runtime. It connects with WebdriverIO's remote() over WebDriver Classic,
// because tauri-driver doesn't speak WebDriver BiDi. The app gets a fresh OPENNOTE_PROFILE_DIR, so tests never
// touch real settings or notes. Specs run with `node --test`.
//
// These variables say where the tools are:
//
// - OPENNOTE_E2E_EXE names the app. Without it: target/e2e/opennote.exe, then target/debug/opennote.exe.
//
// - TAURI_DRIVER names tauri-driver. Without it: the one `cargo install` puts in ~/.cargo/bin.
//
// - MSEDGEDRIVER names msedgedriver. Without it: the newest one edgedriver.ps1 cached in tests/e2e/.drivers.
//
// tauri-driver's output goes to tests/e2e/logs, which CI keeps when a spec fails.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { remote } from 'webdriverio';

export type Browser = Awaited<ReturnType<typeof remote>>;

export interface AppSession {
  readonly browser: Browser;
  readonly profileDir: string;
  close(): Promise<void>;
}

export interface LaunchOptions {
  exe?: string;
  env?: Record<string, string>;
  /** Makes clicks, pointer moves, and drags throw, so a keyboard-only spec can't pass by using the mouse. */
  keyboardOnly?: boolean;
  /** Reuse a profile, for example to relaunch after a change. Default: a fresh temporary one. */
  profileDir?: string;
}

export const ROOT = resolve(import.meta.dirname, '..', '..');

const first = (...paths: (string | undefined)[]) => paths.find((path) => path && existsSync(path));

/** The newest msedgedriver that edgedriver.ps1 cached, one folder per WebView2 version. */
function cachedEdgeDriver(): string | undefined {
  const folder = join(ROOT, 'tests', 'e2e', '.drivers');
  if (!existsSync(folder)) return undefined;
  const versions = readdirSync(folder).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return versions.length ? join(folder, versions[versions.length - 1], 'msedgedriver.exe') : undefined;
}

export function tools(): { exe?: string; tauriDriver?: string; edgeDriver?: string } {
  const exe = process.platform === 'win32' ? '.exe' : '';
  return {
    exe: first(
      process.env.OPENNOTE_E2E_EXE,
      join(ROOT, 'target', 'e2e', 'opennote.exe'),
      join(ROOT, 'target', 'debug', 'opennote.exe'),
    ),
    tauriDriver: first(process.env.TAURI_DRIVER, join(homedir(), '.cargo', 'bin', `tauri-driver${exe}`)),
    edgeDriver: first(process.env.MSEDGEDRIVER, cachedEdgeDriver()),
  };
}

/**
 * Whether this machine can run the E2E specs. Without the app or the drivers, specs skip locally, and CI fails,
 * because CI must always run them.
 */
export function skipReason(): string | false {
  const found = tools();
  const missing = Object.entries(found)
    .filter(([, path]) => !path)
    .map(([name]) => name);
  if (missing.length === 0) return false;
  const reason = `E2E needs ${missing.join(', ')}; see tests/e2e/harness.ts`;
  if (process.env.CI) throw new Error(reason);
  return reason;
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? done(address.port) : fail(new Error('No port'))));
    });
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((done) => {
      const socket = connect(port, '127.0.0.1', () => socket.end(() => done(true)));
      socket.on('error', () => done(false));
    });
    if (open) return;
    await new Promise((wait) => setTimeout(wait, 200));
  }
  throw new Error(`tauri-driver didn't open port ${port} within ${timeoutMs} ms`);
}

type Overwrite = (
  name: string,
  fn: (original: (...args: unknown[]) => unknown, ...args: unknown[]) => unknown,
  element?: boolean,
) => void;

/** Pointer commands and pointer or wheel actions throw in keyboard-only sessions. */
function keyboardOnly(browser: Browser): void {
  const overwrite = browser.overwriteCommand.bind(browser) as unknown as Overwrite;
  for (const name of ['click', 'doubleClick', 'moveTo', 'dragAndDrop']) {
    overwrite(
      name,
      () => {
        throw new Error(`Keyboard-only specs can't use ${name}; use browser.keys.`);
      },
      true,
    );
  }
  overwrite('action', (original, type, ...rest) => {
    if (type !== 'key') throw new Error(`Keyboard-only specs can't send ${String(type)} actions.`);
    return original(type, ...rest);
  });
}

export async function launchApp(options: LaunchOptions = {}): Promise<AppSession> {
  const found = tools();
  const exe = options.exe ?? found.exe;
  if (!exe || !found.tauriDriver || !found.edgeDriver) throw new Error(String(skipReason()));
  const profileDir = options.profileDir ?? mkdtempSync(join(tmpdir(), 'opennote-e2e-'));
  const [port, nativePort] = [await freePort(), await freePort()];
  const args = ['--port', String(port), '--native-port', String(nativePort), '--native-driver', found.edgeDriver];
  const logs = join(ROOT, 'tests', 'e2e', 'logs');
  mkdirSync(logs, { recursive: true });
  const log = openSync(join(logs, `tauri-driver-${Date.now()}.log`), 'a');
  const driver = spawn(found.tauriDriver, args, {
    env: { ...process.env, OPENNOTE_PROFILE_DIR: profileDir, ...options.env },
    stdio: ['ignore', log, log],
  });
  await waitForPort(port, 20_000);
  const browser = await remote({
    hostname: '127.0.0.1',
    port,
    logLevel: 'warn',
    capabilities: {
      'tauri:options': { application: exe },
      'wdio:enforceWebDriverClassic': true,
    } as WebdriverIO.Capabilities,
  });
  if (options.keyboardOnly) keyboardOnly(browser);
  return {
    browser,
    profileDir,
    async close() {
      await browser.deleteSession().catch(() => {});
      driver.kill();
      if (!options.profileDir) rmSync(profileDir, { recursive: true, force: true });
    },
  };
}
