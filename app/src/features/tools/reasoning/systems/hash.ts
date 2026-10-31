// Digests and checksums of text or bytes: MD5 (RFC 1321), SHA-1 and SHA-256 (FIPS 180-4), and CRC-32 (the IEEE
// 802.3 polynomial, reflected). All are written here so the kit's forms can answer at once without waiting on the
// platform's asynchronous crypto; the tests check them against published vectors and Node's own digests.
import { fail } from '../core/util';

export type HashAlgo = 'md5' | 'sha1' | 'sha256' | 'crc32';

/** Bytes from text: UTF-8, or hex digits in pairs (spaces and colons ignored). */
export function bytesOf(text: string, as: 'text' | 'hex'): Uint8Array {
  if (as === 'text') return new TextEncoder().encode(text);
  const hex = text.replace(/[\s:]/g, '').replace(/^0x/i, '');
  if (!/^([0-9a-f]{2})*$/i.test(hex)) fail('hexBytes');
  if (hex.length > 2_000_000) fail('inputLong');
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

const hexOf = (words: readonly number[], little: boolean): string =>
  words
    .map((w) => {
      const b = [24, 16, 8, 0].map((s) => ((w >>> s) & 255).toString(16).padStart(2, '0'));
      return (little ? b.reverse() : b).join('');
    })
    .join('');

/** The message padded to a multiple of 64 bytes with the bit length at the end, little- or big-endian. */
function padded(msg: Uint8Array, little: boolean): DataView {
  const len = Math.ceil((msg.length + 9) / 64) * 64;
  const buf = new Uint8Array(len);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  const bits = msg.length * 8;
  const lo = bits >>> 0;
  const hi = Math.floor(bits / 2 ** 32) >>> 0;
  if (little) {
    view.setUint32(len - 8, lo, true);
    view.setUint32(len - 4, hi, true);
  } else {
    view.setUint32(len - 8, hi, false);
    view.setUint32(len - 4, lo, false);
  }
  return view;
}

const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n));
const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(msg: Uint8Array): string {
  const v = padded(msg, true);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let off = 0; off < v.byteLength; off += 64) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i += 1) {
      const q = i >> 4;
      const f = q === 0 ? (b & c) | (~b & d) : q === 1 ? (d & b) | (~d & c) : q === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = q === 0 ? i : q === 1 ? (5 * i + 1) % 16 : q === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
      const t = d;
      d = c;
      c = b;
      b = (b + rotl((a + f + MD5_K[i] + v.getUint32(off + 4 * g, true)) | 0, MD5_S[q * 4 + (i % 4)])) | 0;
      a = t;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  return hexOf([a0, b0, c0, d0], true);
}

export function sha1(msg: Uint8Array): string {
  const v = padded(msg, false);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Array<number>(80);
  for (let off = 0; off < v.byteLength; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = v.getUint32(off + 4 * i, false);
    for (let i = 16; i < 80; i += 1) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i += 1) {
      const [f, k] =
        i < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : i < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : i < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    [a, b, c, d, e].forEach((x, i) => (h[i] = (h[i] + x) | 0));
  }
  return hexOf(h, false);
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];

export function sha256(msg: Uint8Array): string {
  const v = padded(msg, false);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  for (let off = 0; off < v.byteLength; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = v.getUint32(off + 4 * i, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, k].forEach((x, i) => (h[i] = (h[i] + x) | 0));
  }
  return hexOf(h, false);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(msg: Uint8Array): string {
  let c = 0xffffffff;
  for (const b of msg) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

export const DIGESTS: Readonly<Record<HashAlgo, (msg: Uint8Array) => string>> = { md5, sha1, sha256, crc32 };
