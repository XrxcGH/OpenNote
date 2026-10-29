// Picture sizes from headers, read before decoding, and the kept-uploads cap. The headers are built here.
import { describe, expect, it } from 'vitest';
import { imageSize } from './imageSize';
import { fitKept, LIMITS } from './style';
import type { KeptUpload } from './style';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part)));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const le32 = (n: number) => [...le16(n & 0xffff), ...le16(n >>> 16)];

describe('imageSize', () => {
  it('reads PNG, JPEG, GIF, WebP, and BMP sizes, however large a small file claims to be', () => {
    expect(imageSize(bytes([0x89], 'PNG\r\n\x1a\n', be32(13), 'IHDR', be32(60000), be32(60000)))).toEqual({
      width: 60000,
      height: 60000,
    });
    // A JPEG with an APP0 segment before its frame header.
    const app0 = [0xff, 0xe0, 0, 16, ...new Array(14).fill(0)];
    const sof = [0xff, 0xc0, 0, 17, 8, ...[0x0b, 0xb8], ...[0x0f, 0xa0], 3];
    expect(imageSize(bytes([0xff, 0xd8], app0, sof))).toEqual({ width: 4000, height: 3000 });
    expect(imageSize(bytes('GIF89a', le16(640), le16(480)))).toEqual({ width: 640, height: 480 });
    expect(imageSize(bytes('RIFF', le32(0), 'WEBPVP8X', le32(10), le32(0), le24(1919), le24(1079)))).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(imageSize(bytes('BM', new Array(16).fill(0), le32(800), le32(-600 >>> 0)))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('gives null for anything else, a cut-off header, or a zero size', () => {
    expect(imageSize(bytes('%PDF-1.4'))).toBeNull();
    expect(imageSize(bytes([0xff, 0xd8, 0xff]))).toBeNull();
    expect(imageSize(bytes([0x89], 'PNG\r\n\x1a\n', be32(13), 'IHDR', be32(0), be32(10)))).toBeNull();
    expect(imageSize(new Uint8Array(0))).toBeNull();
    // A JPEG whose segments run off the end.
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2]))).toBeNull();
  });
});

describe('fitKept', () => {
  const upload = (name: string, chars: number): KeptUpload => ({
    name,
    type: 'image/png',
    data: 'A'.repeat(chars),
    at: 0,
  });

  it('keeps the newest files inside the byte and count caps, and counts the ones let go', () => {
    const big = Math.ceil(LIMITS.keptBytes / 3) * 3; // three quarters of the cap, as base64
    const out = fitKept([upload('old', big), upload('new', big)]);
    expect(out.kept.map((k) => k.name)).toEqual(['new']);
    expect(out.letGo).toBe(1);
    const many = fitKept(Array.from({ length: LIMITS.keptUploads + 3 }, (_, i) => upload(String(i), 10)));
    expect(many.kept).toHaveLength(LIMITS.keptUploads);
    expect(many.kept[0].name).toBe('3');
    expect(many.letGo).toBe(3);
  });

  it('never keeps a single file larger than the cap', () => {
    expect(fitKept([upload('huge', LIMITS.keptBytes * 2)])).toEqual({ kept: [], letGo: 1 });
  });
});
