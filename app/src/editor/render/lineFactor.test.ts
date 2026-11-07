// The known answer for Word's single line height (text DESIGN.md 6.5): the factor is read back from the bundled
// fonts' own OS/2 table, (usWinAscent + usWinDescent) / unitsPerEm, which is what Word measures a "single" line by.
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LINE_FACTOR, lineFactor, setLineFactor } from './lineFactor';

const FONTS = new URL('../../theme/fonts/', import.meta.url);

/** An UIntBase128 of a WOFF2 table directory, and the offset after it. */
function base128(data: Buffer, start: number): [number, number] {
  let value = 0;
  let at = start;
  for (let i = 0; i < 5; i++) {
    const byte = data[at++];
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return [value, at];
}

// The WOFF2 specification's table of known tag numbers, up to `prep` and the tables a Latin font can hold.
const KNOWN_TAGS = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'CFF2',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
];

/** usWinAscent, usWinDescent, and unitsPerEm of a WOFF2 font. */
function metrics(file: string): { winAscent: number; winDescent: number; unitsPerEm: number } {
  const data = readFileSync(new URL(file, FONTS));
  const tables = data.readUInt16BE(12);
  const compressedSize = data.readUInt32BE(20);
  let at = 48;
  const entries: { tag: string; length: number }[] = [];
  for (let i = 0; i < tables; i++) {
    const flags = data[at++];
    let tag: string;
    if ((flags & 0x3f) === 0x3f) {
      tag = data.toString('latin1', at, at + 4);
      at += 4;
    } else {
      tag = KNOWN_TAGS[flags & 0x3f] ?? '';
    }
    let length: number;
    [length, at] = base128(data, at);
    // glyf and loca are transformed by default (transform version 0): their stored length follows.
    if ((tag === 'glyf' || tag === 'loca') && flags >> 6 === 0) [length, at] = base128(data, at);
    entries.push({ tag, length });
  }
  const stream = brotliDecompressSync(data.subarray(at, at + compressedSize));
  let offset = 0;
  const found: Record<string, Buffer> = {};
  for (const { tag, length } of entries) {
    found[tag] = stream.subarray(offset, offset + length);
    offset += length;
  }
  return {
    winAscent: found['OS/2'].readUInt16BE(74),
    winDescent: found['OS/2'].readUInt16BE(76),
    unitsPerEm: found.head.readUInt16BE(18),
  };
}

describe('Word single line factor', () => {
  it('reads 2500 / 2048 for Carlito, the metric twin of Calibri, about 13.4 pt at 11 pt', () => {
    const font = metrics('carlito-latin-400-normal.woff2');
    const factor = (font.winAscent + font.winDescent) / font.unitsPerEm;
    expect(factor * 11).toBeGreaterThan(13.3);
    expect(factor * 11).toBeLessThan(13.5);
    expect(lineFactor('Carlito')).toBeCloseTo(factor, 4);
    expect(lineFactor('Calibri')).toBeCloseTo(factor, 4);
  });

  it('matches Caladea to the font file and keeps Cambria at its own Word factor', () => {
    const font = metrics('caladea-latin-400-normal.woff2');
    expect(lineFactor('Caladea')).toBeCloseTo((font.winAscent + font.winDescent) / font.unitsPerEm, 4);
    // Caladea matches Cambria's advance widths, not its line metrics: a run that names Cambria keeps Cambria's own
    // (usWinAscent 1946 + usWinDescent 455 of 2048), so a Word page breaks the same with either face drawn.
    expect(lineFactor('Cambria')).toBeCloseTo(2401 / 2048, 6);
  });

  it('uses the default for a font it knows nothing about, and learns a device font', () => {
    expect(lineFactor('Unknown Face')).toBe(DEFAULT_LINE_FACTOR);
    setLineFactor('Unknown Face', 1.31);
    expect(lineFactor('unknown face')).toBe(1.31);
    setLineFactor('Unknown Face', 9);
    expect(lineFactor('Unknown Face')).toBe(1.31);
  });
});
