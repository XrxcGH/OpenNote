// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RELEASE_FILES, writeManifest } from '../write-manifest.ts';
import { parsePublicKey } from './minisign.ts';
import { runTauri, signRelease, type Tauri } from './sign.ts';
import { fakeExe, newTestKey } from './test-support.ts';
import { verifyRelease } from './verify.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function folder(withExes = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-sign-'));
  dirs.push(dir);
  if (withExes) RELEASE_FILES.forEach(({ file }) => writeFileSync(join(dir, file), fakeExe(file)));
  return dir;
}

interface Call {
  args: string[];
  env: Record<string, string>;
}

/** A stand-in for the Tauri tool that records each call, and writes the files the real one would. */
function recorder(calls: Call[]): Tauri {
  return (args, env) => {
    calls.push({ args, env });
    if (args[1] === 'sign') writeFileSync(`${args.at(-1)}.sig`, 'signature');
    if (args[1] === 'generate') {
      const path = args[args.indexOf('--write-keys') + 1];
      writeFileSync(path, 'private key');
      writeFileSync(`${path}.pub`, 'public key');
    }
  };
}

describe('signing with the release key', () => {
  it('signs every exe for the tag, with the key and password from the environment', () => {
    const calls: Call[] = [];
    const env = { PATH: '/bin', TAURI_SIGNING_PRIVATE_KEY: 'secret key', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'pw' };
    const dir = folder();
    signRelease({ dir, tag: 'v1.2.3', env, tauri: recorder(calls) });
    expect(calls.map((call) => call.args.slice(0, 4))).toEqual(
      RELEASE_FILES.map(() => ['signer', 'sign', '--app-version', '1.2.3']),
    );
    expect(calls.map((call) => call.args.at(-1))).toEqual(RELEASE_FILES.map(({ file }) => join(dir, file)));
    expect(calls[0].env).toEqual(env);
  });

  it('works for a key without a password', () => {
    const calls: Call[] = [];
    signRelease({ dir: folder(), tag: 'v1.2.3', env: { TAURI_SIGNING_PRIVATE_KEY: 'k' }, tauri: recorder(calls) });
    expect(calls[0].env).toEqual({ TAURI_SIGNING_PRIVATE_KEY: 'k' });
  });

  it.each([undefined, ''])('stops when the key is %j, so nothing is published unsigned', (key) => {
    const calls: Call[] = [];
    const env = { TAURI_SIGNING_PRIVATE_KEY: key };
    const run = () => signRelease({ dir: folder(), tag: 'v1.2.3', env, tauri: recorder(calls) });
    expect(run).toThrow('TAURI_SIGNING_PRIVATE_KEY secret is not set');
    expect(calls).toEqual([]);
  });

  it('stops when an exe is missing or the tool writes no signature', () => {
    const env = { TAURI_SIGNING_PRIVATE_KEY: 'k' };
    const dir = folder();
    rmSync(join(dir, 'OpenNote_Windows32.exe'));
    expect(() => signRelease({ dir, tag: 'v1.2.3', env, tauri: recorder([]) })).toThrow('no OpenNote_Windows32.exe');
    expect(() => signRelease({ dir: folder(), tag: 'v1.2.3', env, tauri: () => undefined })).toThrow(
      'did not write OpenNote_Windows64.exe.sig',
    );
  });
});

describe('a dry run', () => {
  it('makes a throwaway key, signs with it, keeps only the public key, and never uses the release key', () => {
    const calls: Call[] = [];
    const env = { PATH: '/bin', TAURI_SIGNING_PRIVATE_KEY: 'real secret', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'real' };
    const pubkeyOut = join(folder(false), 'update.pub');
    const dir = folder();
    signRelease({ dir, tag: 'v1.2.3', env, dryRun: true, pubkeyOut, tauri: recorder(calls) });
    expect(calls[0].args.slice(0, 3)).toEqual(['signer', 'generate', '--ci']);
    expect(readFileSync(pubkeyOut, 'utf8')).toBe('public key');
    for (const call of calls) {
      expect(call.env.PATH).toBe('/bin');
      expect(call.env.TAURI_SIGNING_PRIVATE_KEY).not.toBe('real secret');
      expect(call.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).not.toBe('real');
    }
    const signing = calls.filter((call) => call.args[1] === 'sign');
    expect(signing).toHaveLength(RELEASE_FILES.length);
    expect(signing[0].env.TAURI_SIGNING_PRIVATE_KEY).toBe('private key');
    const keyPath = calls[0].args[calls[0].args.indexOf('--write-keys') + 1];
    expect(existsSync(keyPath)).toBe(false);
  });

  it('makes the folder for the public key when it does not exist', () => {
    const pubkeyOut = join(folder(false), 'dry-run', 'nested', 'update.pub');
    signRelease({ dir: folder(), tag: 'v1.2.3', env: {}, dryRun: true, pubkeyOut, tauri: recorder([]) });
    expect(readFileSync(pubkeyOut, 'utf8')).toBe('public key');
  });

  it('needs somewhere to put the public key', () => {
    const run = () => signRelease({ dir: folder(), tag: 'v1.2.3', env: {}, dryRun: true, tauri: recorder([]) });
    expect(run).toThrow('--pubkey-out');
  });

  it('deletes the throwaway private key even when signing fails', () => {
    const calls: Call[] = [];
    const failing: Tauri = (args, env) => {
      recorder(calls)(args, env);
      if (args[1] === 'sign') throw new Error('the tool failed');
    };
    const pubkeyOut = join(folder(false), 'update.pub');
    expect(() =>
      signRelease({ dir: folder(), tag: 'v1.2.3', env: {}, dryRun: true, pubkeyOut, tauri: failing }),
    ).toThrow('the tool failed');
    expect(existsSync(calls[0].args[calls[0].args.indexOf('--write-keys') + 1])).toBe(false);
  });
});

describe('the real Tauri command-line tool', () => {
  const hasTool = existsSync(
    join(import.meta.dirname, '..', '..', '..', 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
  );

  it.skipIf(!hasTool)(
    'signs in a dry run, and verify.ts accepts what it made',
    () => {
      const dir = folder();
      const pubkeyOut = join(folder(false), 'update.pub');
      const env = {
        ...process.env,
        TAURI_SIGNING_PRIVATE_KEY: undefined,
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: undefined,
      };
      signRelease({ dir, tag: 'v1.2.3', env, dryRun: true, pubkeyOut, tauri: runTauri });
      writeManifest(dir, 'v1.2.3', 'Notes.', '2026-10-14T18:02:11.000Z');
      const keys = [parsePublicKey(readFileSync(pubkeyOut, 'utf8'))];
      expect(verifyRelease({ dir, tag: 'v1.2.3', keys })).toEqual([]);
      expect(verifyRelease({ dir, tag: 'v1.2.4', keys }).length).toBeGreaterThan(0);
      expect(verifyRelease({ dir, tag: 'v1.2.3', keys: [newTestKey().publicKey] }).length).toBeGreaterThan(0);
    },
    120_000,
  );

  it.skipIf(!hasTool)(
    'signs with a given key, when its password is right',
    () => {
      const dir = folder();
      const keys = join(folder(false), 'release.key');
      const env = {
        ...process.env,
        TAURI_SIGNING_PRIVATE_KEY: undefined,
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: undefined,
      };
      const plain = { ...process.env } as Record<string, string>;
      runTauri(['signer', 'generate', '--ci', '--password', 'pw-for-this-test', '--write-keys', keys], plain);
      const secret = {
        ...env,
        TAURI_SIGNING_PRIVATE_KEY: readFileSync(keys, 'utf8'),
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'pw-for-this-test',
      };
      signRelease({ dir, tag: 'v2.0.0-beta.1', env: secret });
      writeManifest(dir, 'v2.0.0-beta.1', 'Notes.', '2026-10-14T18:02:11.000Z');
      const trusted = [parsePublicKey(readFileSync(`${keys}.pub`, 'utf8'))];
      expect(verifyRelease({ dir, tag: 'v2.0.0-beta.1', keys: trusted })).toEqual([]);
      expect(() =>
        signRelease({ dir, tag: 'v2.0.0', env: { ...secret, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'wrong' } }),
      ).toThrow();
    },
    120_000,
  );
});
