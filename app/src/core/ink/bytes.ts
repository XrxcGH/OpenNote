// Byte helpers for the ink codec: CRC-32 (spec 2.1) and IDs in their text form (spec 2.4).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of zlib, gzip, and PNG. Its check value for the ASCII bytes `123456789` is `cbf43926`. */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const DIGITS = new Map([...ALPHABET].map((c, i) => [c, i]));

/** The 26-character text of the 16-byte ID at `offset`. */
export function idText(bytes: Uint8Array, offset: number): string {
  let out = '';
  let acc = 0;
  let bits = 2;
  for (let i = offset; i < offset + 16; i++) {
    acc = ((acc << 8) | bytes[i]) & 0x1fff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
    }
  }
  return out;
}

/** The 16 bytes of an ID's text. Uppercase letters are accepted, as spec 2.4 requires. */
export function idBytes(text: string): Uint8Array {
  const lower = text.toLowerCase();
  if (lower.length !== 26 || !'01234567'.includes(lower[0])) throw new Error(`not an ID: ${text}`);
  const out = new Uint8Array(16);
  let acc = 0;
  let bits = -2;
  let at = 0;
  for (const c of lower) {
    const digit = DIGITS.get(c);
    if (digit === undefined) throw new Error(`not an ID: ${text}`);
    acc = ((acc << 5) | digit) & 0x1fff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** An `i64` at `offset` as a number. Values past 2^53 lose precision, which the timestamp range rules out. */
export function readI64(view: DataView, offset: number): number {
  return view.getInt32(offset + 4, true) * 2 ** 32 + view.getUint32(offset, true);
}

/** Writes a number as an `i64` at `offset`. */
export function writeI64(view: DataView, offset: number, value: number): void {
  const high = Math.floor(value / 2 ** 32);
  view.setUint32(offset, value - high * 2 ** 32, true);
  view.setInt32(offset + 4, high, true);
}
