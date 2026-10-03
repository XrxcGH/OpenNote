// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_ENDPOINTS_MARKER, committedKeys, isPublicKey, problems, publicKeysIn } from './check-release-exe.ts';

/** A random minisign public key line: "Ed", an 8-byte key id, and a 32-byte key, in base64. */
const newKey = () => Buffer.concat([Buffer.from('Ed'), randomBytes(40)]).toString('base64');

/** The text of a .pub file, as `tauri signer generate` writes it: base64 of the two-line minisign key. */
const pubFile = (key: string) =>
  Buffer.from(`untrusted comment: minisign public key: 0123456789ABCDEF\n${key}\n`).toString('base64');

/** An exe-like buffer: binary noise, then the given strings, each after a zero byte as in a string table. */
const exe = (...strings: string[]) =>
  Buffer.concat([randomBytes(64), ...strings.flatMap((s) => [Buffer.from([0]), Buffer.from(s, 'latin1')])]);

let dirs: string[] = [];
afterEach(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  dirs = [];
});

function keysDir(...keys: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-keys-'));
  dirs.push(dir);
  keys.forEach((key, i) => writeFileSync(join(dir, `key${i}.pub`), pubFile(key)));
  writeFileSync(join(dir, 'README.md'), '# Not a key');
  return dir;
}

describe('isPublicKey', () => {
  it('accepts only 56 characters that decode to a key with the Ed algorithm', () => {
    const key = newKey();
    expect(key).toMatch(/^RW[QRST]/);
    expect(isPublicKey(key)).toBe(true);
    expect(isPublicKey(Buffer.concat([Buffer.from('Ex'), randomBytes(40)]).toString('base64'))).toBe(false);
    expect(isPublicKey(key.slice(0, 55))).toBe(false);
  });
});

describe('publicKeysIn', () => {
  it('finds key text and keys inside base64 .pub text', () => {
    const [plain, encoded] = [newKey(), newKey()];
    expect(publicKeysIn(exe(`untrusted comment: x\n${plain}\n`, pubFile(encoded))).sort()).toEqual(
      [plain, encoded].sort(),
    );
  });

  it('skips look-alikes, such as runs of capital letters in key name tables', () => {
    const tables = `RW${'MAILFORWARDMEDIASELECTLAUNCHAPP'.repeat(2).slice(0, 54)}`;
    const inside = `A${newKey()}`;
    const followed = `${newKey()}B`;
    expect(publicKeysIn(exe(tables, inside, followed, `RWA${'A'.repeat(53)}`))).toEqual([]);
  });
});

describe('problems', () => {
  it('passes an exe with only committed keys and no test marker', () => {
    const [active, backup] = [newKey(), newKey()];
    const allowed = committedKeys(keysDir(active, backup));
    expect(allowed).toEqual(new Set([active, backup]));
    expect(problems(exe('opennote', `untrusted comment: a\n${active}\n`, backup), allowed)).toEqual([]);
    expect(problems(exe('no keys at all'), new Set())).toEqual([]);
  });

  it('fails an exe built with the test endpoints', () => {
    expect(problems(exe('log text', `${TEST_ENDPOINTS_MARKER}: this build accepts test endpoints`), new Set())).toEqual(
      [`It was built with the test-endpoints feature: it contains ${TEST_ENDPOINTS_MARKER}.`],
    );
  });

  it('fails an exe with a key that is not committed, in either form', () => {
    const [committed, stray, test] = [newKey(), newKey(), newKey()];
    const allowed = committedKeys(keysDir(committed));
    expect(problems(exe(committed, stray, pubFile(test)), allowed)).toEqual([
      `It contains the public key ${stray}, which isn't in app/src-tauri/keys.`,
      `It contains the public key ${test}, which isn't in app/src-tauri/keys.`,
    ]);
  });

  it('reads no keys from a missing folder', () => {
    expect(committedKeys(join(tmpdir(), 'opennote-no-such-folder'))).toEqual(new Set());
  });
});
