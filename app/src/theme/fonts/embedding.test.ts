// Every bundled font file allows installable embedding (OS/2 fsType 0), so exports may embed them. The woff2
// files are read here as the WOFF2 specification lays them out: a table directory, then one Brotli stream. The
// OS/2 table is never transformed, so its bytes are the font's own.

import { brotliDecompressSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const OS2_TAG_INDEX = 6; // The WOFF2 known-table list: cmap, head, hhea, hmtx, maxp, name, OS/2.
const GLYF = 10;
const LOCA = 11;

function base128(bytes: Uint8Array, at: { i: number }): number {
  let value = 0;
  for (let n = 0; n < 5; n++) {
    const byte = bytes[at.i++]!;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error('a bad UIntBase128');
}

/** The OS/2 fsType of a woff2 file. */
function fsTypeOf(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0)).toBe(0x774f4632);
  const count = view.getUint16(12);
  const compressedSize = view.getUint32(20);
  const at = { i: 48 };
  const lengths: { tag: number; length: number }[] = [];
  for (let t = 0; t < count; t++) {
    const flags = bytes[at.i++]!;
    const tag = flags & 0x3f;
    if (tag === 63) at.i += 4;
    const version = flags >> 6;
    const original = base128(bytes, at);
    const transformed = tag === GLYF || tag === LOCA ? version === 0 : version !== 0;
    lengths.push({ tag, length: transformed ? base128(bytes, at) : original });
  }
  const data = brotliDecompressSync(bytes.subarray(at.i, at.i + compressedSize));
  let offset = 0;
  for (const { tag, length } of lengths) {
    if (tag === OS2_TAG_INDEX) return new DataView(data.buffer, data.byteOffset + offset, length).getUint16(8);
    offset += length;
  }
  throw new Error('no OS/2 table');
}

describe('the bundled fonts', () => {
  const files = readdirSync(import.meta.dirname).filter((name) => name.endsWith('.woff2'));

  it('are there', () => expect(files.length).toBeGreaterThan(0));

  it.each(files)('%s reports installable embedding', (name) => {
    expect(fsTypeOf(readFileSync(join(import.meta.dirname, name)))).toBe(0);
  });
});
