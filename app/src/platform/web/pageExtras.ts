// The web platform's stand-in for the typed-notes extras: a one-pixel blinking caret, no link titles, and
// attachments that stay in memory. Opening an attachment in its own app needs the desktop app.
import type { IpcError, PageExtrasClient } from '../types';
import { createWebImages } from './images';

export function createWebPageExtras(): PageExtrasClient {
  const images = createWebImages();
  return {
    caretMetrics: () => Promise.resolve({ widthPx: 1, blinkMs: 530 }),
    linkTitle: () => Promise.resolve(null),
    attachBytes: (page, bytes, name, mime) => images.importBytes(page, bytes, name, mime),
    openAttachment: () =>
      Promise.reject({
        code: 'notImplemented',
        message: 'Opening an attachment in its own app needs the desktop app.',
      } satisfies IpcError),
    onAttachmentSaved: () => () => undefined,
  };
}
