// Checks minisign signatures the way the updater in crates/updater does, using only Node's crypto. The release
// workflow uses it to confirm that every exe it is about to publish carries a signature the app will accept.
// It only verifies. Signing is left to `tauri signer sign`, so the private key is never read by our own code.

import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';

/** The 12 bytes that turn a raw 32-byte Ed25519 key into the DER form that Node reads. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface PublicKey {
  /** The 8-byte key id that a signature names, so a signature picks the key it was made with. */
  id: Buffer;
  /** The raw 32-byte Ed25519 public key. */
  key: Buffer;
}

export interface Signature {
  /** `ED` signs the BLAKE2b-512 hash of the file. `Ed` is minisign's legacy mode, which signs the whole file. */
  algorithm: string;
  keyId: Buffer;
  signature: Buffer;
  /** The comment after `trusted comment: `. The global signature covers it, so it can't change unnoticed. */
  trustedComment: string;
  globalSignature: Buffer;
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

/** Unwraps the base64 form that `tauri signer` writes: the whole minisign file, encoded again. */
function plainText(text: string, firstLine: string): string {
  return text.trimStart().startsWith(firstLine) ? text : Buffer.from(text.trim(), 'base64').toString('utf8');
}

/**
 * Reads a public key from a `.pub` file as `tauri signer generate` writes it (base64 text of the two-line minisign
 * file), or from the two-line minisign text itself. Throws when it isn't a minisign Ed25519 key.
 */
export function parsePublicKey(text: string): PublicKey {
  const parts = lines(plainText(text, 'untrusted comment:'));
  const bytes = Buffer.from(parts.at(-1) ?? '', 'base64');
  if (bytes.length !== 42 || bytes.subarray(0, 2).toString('latin1') !== 'Ed') {
    throw new Error('The public key is not a minisign Ed25519 key.');
  }
  return { id: bytes.subarray(2, 10), key: bytes.subarray(10) };
}

/**
 * Reads a signature from a `.sig` file as `tauri signer sign` writes it (base64 text of the four-line minisign
 * file), which is also the form the manifest holds, or from the four-line minisign text. Throws when it is malformed.
 */
export function parseSignature(text: string): Signature {
  const parts = lines(plainText(text, 'untrusted comment:'));
  const comment = parts[2] ?? '';
  const prefix = 'trusted comment: ';
  const bytes = Buffer.from(parts[1] ?? '', 'base64');
  const global = Buffer.from(parts[3] ?? '', 'base64');
  if (parts.length !== 4 || !comment.startsWith(prefix) || bytes.length !== 74 || global.length !== 64) {
    throw new Error('The signature is not a minisign signature with a trusted comment.');
  }
  return {
    algorithm: bytes.subarray(0, 2).toString('latin1'),
    keyId: bytes.subarray(2, 10),
    signature: bytes.subarray(10),
    trustedComment: comment.slice(prefix.length),
    globalSignature: global,
  };
}

function ed25519(key: PublicKey, message: Buffer, signature: Buffer): boolean {
  const publicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, key.key]), format: 'der', type: 'spki' });
  return edVerify(null, message, publicKey, signature);
}

/**
 * Checks `data` against a signature and returns its trusted comment, or throws why it can't be trusted. Like the
 * updater, it refuses the legacy mode, a key id that isn't the key's, and a comment the global signature doesn't cover.
 */
export function verify(data: Buffer, signature: Signature, key: PublicKey): string {
  if (signature.algorithm !== 'ED') throw new Error('The signature uses minisign legacy mode, which is not accepted.');
  if (!signature.keyId.equals(key.id)) throw new Error('The signature was made with a different key.');
  const hash = createHash('blake2b512').update(data).digest();
  if (!ed25519(key, hash, signature.signature)) throw new Error('The signature does not match the file.');
  const covered = Buffer.concat([signature.signature, Buffer.from(signature.trustedComment, 'utf8')]);
  if (!ed25519(key, covered, signature.globalSignature)) throw new Error('The trusted comment was changed.');
  return signature.trustedComment;
}

/** Checks `data` against any of several trusted keys, and returns the trusted comment of the first that matches. */
export function verifyWithAny(data: Buffer, signature: Signature, keys: readonly PublicKey[]): string {
  const key = keys.find((candidate) => candidate.id.equals(signature.keyId));
  if (!key) throw new Error('The file is not signed with a key that this release trusts.');
  return verify(data, signature, key);
}

/**
 * The fields of a trusted comment, in order: `timestamp:1790997565<TAB>file:OpenNote_Windows64.exe<TAB>version:1.2.3`.
 * A field can appear twice, so this returns a list, and the caller decides what a repeat means.
 */
export function trustedFields(comment: string): [string, string][] {
  return comment
    .split('\t')
    .filter((field) => field.includes(':'))
    .map((field): [string, string] => [field.slice(0, field.indexOf(':')), field.slice(field.indexOf(':') + 1).trim()]);
}

/** The one value of a field, or undefined when it is missing or appears more than once. */
export function onlyField(comment: string, name: string): string | undefined {
  const values = trustedFields(comment).filter(([key]) => key === name);
  return values.length === 1 ? values[0][1] : undefined;
}
