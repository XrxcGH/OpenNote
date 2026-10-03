// Clipboard facts from the shell (owner after WP0: WP5). clipboard_read answers with the JSON length as 4 bytes,
// the JSON (the facts, html, and text), and then the BMP bytes of an image, if the clipboard holds one.
import type { ClipboardClient, ClipboardContent } from '../types';
import { invoke } from './invoke';

function decodeContent(buffer: ArrayBuffer): ClipboardContent {
  const length = new DataView(buffer).getUint32(0, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length))) as Omit<
    ClipboardContent,
    'imageBmp'
  >;
  const rest = buffer.byteLength - 4 - length;
  return { ...json, imageBmp: rest > 0 ? buffer.slice(4 + length) : null };
}

export function createTauriClipboard(): ClipboardClient {
  return {
    facts: () => invoke('clipboard_facts'),
    read: () => invoke('clipboard_read').then(decodeContent),
  };
}
