// A file as a `data:` URI, so a document can hold its images and fonts itself.

/** A data URI for a file, so the document can hold its images itself. */
export function dataUri(mime: string, bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const safe = /^[a-z]+\/[a-z0-9.+-]+$/i.test(mime) ? mime : 'application/octet-stream';
  return `data:${safe};base64,${btoa(binary)}`;
}
