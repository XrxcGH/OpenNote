// Helpers for the release script tests: a throwaway minisign key that signs the way `tauri signer sign` does, and a
// release folder that looks like the one the workflow makes. Nothing here runs outside the tests.

import { createHash, generateKeyPairSync, randomBytes, sign as edSign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASE_FILES, versionOf, writeManifest } from '../write-manifest.ts';
import type { PublicKey } from './minisign.ts';

export interface TestKey {
  publicKey: PublicKey;
  /** The `.pub` file as `tauri signer generate` writes it. */
  pubFile: string;
  /** The `.sig` file as `tauri signer sign` writes it, for a file and a version. */
  signFile(data: Buffer, file: string, version: string): string;
  /** A signature with any trusted comment, for the tests that need a wrong one. */
  signWithComment(data: Buffer, comment: string): string;
}

/** A new key pair that signs like the Tauri command-line tool, with a random key id. */
export function newTestKey(): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  const id = randomBytes(8);
  const keyLine = Buffer.concat([Buffer.from('Ed', 'latin1'), id, raw]).toString('base64');
  const pubText = `untrusted comment: minisign public key: ${id.toString('hex')}\n${keyLine}\n`;
  const signWithComment = (data: Buffer, comment: string): string => {
    const signature = edSign(null, createHash('blake2b512').update(data).digest(), privateKey);
    const global = edSign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
    const body = Buffer.concat([Buffer.from('ED', 'latin1'), id, signature]).toString('base64');
    const lines = ['untrusted comment: signature from tauri secret key', body];
    lines.push(`trusted comment: ${comment}`, global.toString('base64'));
    return Buffer.from(`${lines.join('\n')}\n`).toString('base64');
  };
  return {
    publicKey: { id, key: raw },
    pubFile: Buffer.from(pubText).toString('base64'),
    signFile: (data, file, version) => signWithComment(data, `timestamp:1790997565\tfile:${file}\tversion:${version}`),
    signWithComment,
  };
}

/** A minimal PE file: DOS header, PE header, and an optional header with room for a certificate table. */
export function fakePe(options: { plus?: boolean; signed?: boolean; directories?: number } = {}): Buffer {
  const { plus = true, signed = false, directories = 16 } = options;
  const pe = 0x80;
  const optional = pe + 24;
  const buffer = Buffer.alloc(0x400);
  buffer.write('MZ', 0, 'latin1');
  buffer.writeUInt32LE(pe, 0x3c);
  buffer.write('PE\0\0', pe, 'latin1');
  buffer.writeUInt16LE(plus ? 0x20b : 0x10b, optional);
  buffer.writeUInt32LE(directories, optional + (plus ? 108 : 92));
  if (signed) {
    const entry = optional + (plus ? 112 : 96) + 4 * 8;
    buffer.writeUInt32LE(0x300, entry);
    buffer.writeUInt32LE(0x80, entry + 4);
  }
  return buffer;
}

/** The bytes of a fake exe. They differ per file, so a swapped file shows up. */
export function fakeExe(file: string): Buffer {
  return Buffer.concat([Buffer.from('MZ'), Buffer.from(`fake ${file}`.repeat(20))]);
}

/** Writes the three signed exes, their `.sig` files, and the manifest for `tag` into `dir`. */
export function writeSampleRelease(
  dir: string,
  tag: string,
  key: TestKey,
  options: { notes?: string; exe?: (file: string) => Buffer } = {},
): string {
  mkdirSync(dir, { recursive: true });
  for (const { file } of RELEASE_FILES) {
    const exe = (options.exe ?? fakeExe)(file);
    writeFileSync(join(dir, file), exe);
    writeFileSync(join(dir, `${file}.sig`), key.signFile(exe, file, versionOf(tag)));
  }
  return writeManifest(dir, tag, options.notes ?? `OpenNote ${tag}`, '2026-10-14T18:02:11.000Z').name;
}
