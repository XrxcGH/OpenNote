// A small .zip writer and reader for project export and import, from the PKWARE .ZIP File Format Specification
// (APPNOTE.TXT, sections 4.3 and 4.4). The writer stores files without compression, with UTF-8 names (flag bit 11)
// and a fixed date, so the same project always gives the same bytes. The reader takes stored and deflated entries
// (method 0 and 8); it refuses encrypted and ZIP64 archives, and never inflates an entry past the size it may hold.

import { crc32 } from '../../../core/ink/bytes';

export interface ZipEntry {
  path: string;
  bytes: Uint8Array;
}

/** An entry the reader did not open, because it is larger than the caller allows. */
export interface ZipSkipped {
  path: string;
  tooBig: true;
}

export class ZipError extends Error {
  constructor(readonly code: 'notZip' | 'zip64' | 'encrypted' | 'method' | 'corrupt') {
    super(`zip: ${code}`);
  }
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8_NAMES = 0x0800;
/** 1980-01-01 00:00 in MS-DOS date and time, the earliest the format holds. */
const DOS_DATE = (1 << 5) | 1;
const DOS_TIME = 0;
const VERSION = 20;

const encoder = new TextEncoder();

/** The archive bytes of the entries, in order. */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  const names = entries.map((entry) => encoder.encode(entry.path));
  const crcs = entries.map((entry) => crc32(entry.bytes));
  const localSize = entries.reduce((sum, entry, i) => sum + 30 + names[i].length + entry.bytes.length, 0);
  const centralSize = names.reduce((sum, name) => sum + 46 + name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (value: number) => {
    view.setUint16(at, value, true);
    at += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(at, value >>> 0, true);
    at += 4;
  };
  const offsets: number[] = [];
  entries.forEach((entry, i) => {
    offsets.push(at);
    u32(LOCAL);
    u16(VERSION);
    u16(UTF8_NAMES);
    u16(0);
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(crcs[i]);
    u32(entry.bytes.length);
    u32(entry.bytes.length);
    u16(names[i].length);
    u16(0);
    out.set(names[i], at);
    at += names[i].length;
    out.set(entry.bytes, at);
    at += entry.bytes.length;
  });
  const central = at;
  entries.forEach((entry, i) => {
    u32(CENTRAL);
    u16(VERSION);
    u16(VERSION);
    u16(UTF8_NAMES);
    u16(0);
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(crcs[i]);
    u32(entry.bytes.length);
    u32(entry.bytes.length);
    u16(names[i].length);
    u16(0);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(offsets[i]);
    out.set(names[i], at);
    at += names[i].length;
  });
  const centralLength = at - central;
  u32(END);
  u16(0);
  u16(0);
  u16(entries.length);
  u16(entries.length);
  u32(centralLength);
  u32(central);
  u16(0);
  return out;
}

/** Whether the bytes start like a .zip archive. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === LOCAL;
}

async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array | null> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
  } catch {
    throw new ZipError('corrupt');
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The entries of an archive, folders left out. An entry larger than `maxBytes` is listed as skipped, unopened.
 * Throws ZipError when the bytes are not an archive this reader takes.
 */
export async function readZip(bytes: Uint8Array, maxBytes: number): Promise<(ZipEntry | ZipSkipped)[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError('notZip');
  const count = view.getUint16(end + 10, true);
  const offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff) throw new ZipError('zip64');
  const decoder = new TextDecoder();
  const out: (ZipEntry | ZipSkipped)[] = [];
  let at = offset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) throw new ZipError('corrupt');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith('/')) continue;
    if (flags & 1) throw new ZipError('encrypted');
    if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new ZipError('zip64');
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL) throw new ZipError('corrupt');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > bytes.length) throw new ZipError('corrupt');
    if (size > maxBytes) {
      out.push({ path, tooBig: true });
      continue;
    }
    const data = bytes.subarray(start, start + packed);
    let content: Uint8Array | null;
    if (method === 0) content = data;
    else if (method === 8) content = await inflate(data, maxBytes);
    else throw new ZipError('method');
    if (content === null) {
      out.push({ path, tooBig: true });
      continue;
    }
    if (content.length !== size || crc32(content) !== crc) throw new ZipError('corrupt');
    out.push({ path, bytes: content.slice() });
  }
  return out;
}
