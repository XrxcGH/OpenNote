// The pixel size of a PNG or JPEG from its header, for fakes that can't ask Windows Imaging Component.

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  while (at + 9 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    const length = view.getUint16(at + 2);
    // Start-of-frame markers, except DHT (C4), JPG (C8), and DAC (CC), hold the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
    }
    at += 2 + length;
  }
  return null;
}

/** `{ width, height }` for a PNG or JPEG, or an empty object for anything else. */
export function imageSize(bytes: Uint8Array): { width?: number; height?: number } {
  return pngSize(bytes) ?? jpegSize(bytes) ?? {};
}
