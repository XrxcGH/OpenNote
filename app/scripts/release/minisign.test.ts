// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { onlyField, parsePublicKey, parseSignature, trustedFields, verify, verifyWithAny } from './minisign.ts';
import { newTestKey } from './test-support.ts';

// Made by the real Tauri command-line tool (tauri signer generate, then tauri signer sign --app-version 1.2.3), so
// these tests prove that our check agrees with what the release workflow signs. It holds no private key.
const TAURI_PUBLIC_KEY = [
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDRFQzhDRDMyMUZDMjM3Q0IKUldUTE44SWZNczNJVGd4d2dW',
  'a1dtOHJnSmlHa1hNWFo3ZkxWT0gvdSs2UGlvTzBoTDhsNlJHa0cK',
].join('');
const TAURI_SIGNATURE = [
  'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUTE44SWZNczNJVGdGR29ZUDRFcHZp',
  'MnBGRXNLRzExcmtFNzdFLzhaUFc4N2RuLzZCNEZBV0hPY1ZZRWJrODBaVzUwWU45RUtFTExZLytQaHZhQjJlL2hxZGdUTUxZcmd3',
  'PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkwOTk3NTY1CWZpbGU6T3Blbk5vdGVfV2luZG93czY0LmV4ZQl2ZXJzaW9u',
  'OjEuMi4zCkZPMWZlSUtka2dwN2g4WjlNeFZlNzhXUzZ0QWpSTkxuY0lJWWJnZnFYTHRHSXEyRDRWcXBWM3cvZ0l0OUwvRjZISks3',
  'UDBIZHRjSUR4MENQYlNaNkJRPT0K',
].join('');
const TAURI_FILE = Buffer.from('hello exe');

describe('a signature made by tauri signer sign', () => {
  const key = parsePublicKey(TAURI_PUBLIC_KEY);
  const signature = parseSignature(TAURI_SIGNATURE);

  it('verifies and returns its trusted comment', () => {
    const comment = verify(TAURI_FILE, signature, key);
    expect(onlyField(comment, 'version')).toBe('1.2.3');
    expect(onlyField(comment, 'file')).toBe('OpenNote_Windows64.exe');
  });

  it('fails for a changed file', () => {
    expect(() => verify(Buffer.from('hello exe!'), signature, key)).toThrow('does not match the file');
  });

  it('fails when the trusted comment is changed', () => {
    const edited = { ...signature, trustedComment: signature.trustedComment.replace('1.2.3', '9.9.9') };
    expect(() => verify(TAURI_FILE, edited, key)).toThrow('trusted comment was changed');
  });

  it('fails for another key', () => {
    expect(() => verify(TAURI_FILE, signature, newTestKey().publicKey)).toThrow('different key');
    expect(() => verifyWithAny(TAURI_FILE, signature, [newTestKey().publicKey])).toThrow('not signed with a key');
  });

  it('reads the plain minisign text as well as the base64 form', () => {
    const text = Buffer.from(TAURI_SIGNATURE, 'base64').toString('utf8');
    expect(parseSignature(text)).toEqual(signature);
    expect(parsePublicKey(Buffer.from(TAURI_PUBLIC_KEY, 'base64').toString('utf8'))).toEqual(key);
  });
});

describe('signatures made by the test key', () => {
  it('verify with any of several trusted keys', () => {
    const key = newTestKey();
    const data = Buffer.from('exe');
    const signature = parseSignature(key.signFile(data, 'a.exe', '1.0.0'));
    const comment = verifyWithAny(data, signature, [newTestKey().publicKey, parsePublicKey(key.pubFile)]);
    expect(comment).toContain('version:1.0.0');
  });

  it('refuse minisign legacy mode', () => {
    const key = newTestKey();
    const signature = parseSignature(key.signFile(Buffer.from('x'), 'a.exe', '1.0.0'));
    expect(() => verify(Buffer.from('x'), { ...signature, algorithm: 'Ed' }, key.publicKey)).toThrow('legacy');
  });
});

describe('malformed input', () => {
  it('is refused with a sentence, not a crash', () => {
    expect(() => parseSignature('not a signature')).toThrow('not a minisign signature');
    expect(() => parseSignature('')).toThrow('not a minisign signature');
    expect(() => parsePublicKey('bm90IGEga2V5')).toThrow('not a minisign Ed25519 key');
    expect(() => parsePublicKey('')).toThrow('not a minisign Ed25519 key');
  });
});

describe('trusted comment fields', () => {
  it('lists every field in order and finds the only one', () => {
    expect(trustedFields('timestamp:1\tfile:a.exe\tversion:1.0.0')).toEqual([
      ['timestamp', '1'],
      ['file', 'a.exe'],
      ['version', '1.0.0'],
    ]);
    expect(onlyField('file:a.exe\tversion:1.0.0', 'version')).toBe('1.0.0');
  });

  it('treats a missing or repeated field as no value, so a repeat cannot hide the real one', () => {
    expect(onlyField('file:a.exe', 'version')).toBeUndefined();
    expect(onlyField('version:1.0.0\tversion:9.9.9', 'version')).toBeUndefined();
  });
});
