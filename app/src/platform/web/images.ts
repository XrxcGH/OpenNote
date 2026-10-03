// The web platform's image import (owner after WP0: WP5): bytes stay in memory, and PNG and JPEG sizes come from
// their headers. Imports by address and by clipboard token need the shell, so they reject with notImplemented.
import { newId } from '../../editor/ids';
import { imageSize } from '../../services/pages/memory/imageSize';
import type { AssetJson } from '../../services/pages/types';
import type { ImagesClient, IpcError } from '../types';

const notImplemented = (what: string): Promise<never> =>
  Promise.reject({ code: 'notImplemented', message: `${what} needs the desktop app.` } satisfies IpcError);

export function createWebImages(): ImagesClient {
  return {
    async importBytes(_page, bytes, name, mime) {
      const data = new Uint8Array(bytes.slice(0));
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
      const id = newId();
      const asset: AssetJson = {
        file: `${id}.${mime.split('/')[1] ?? 'bin'}`,
        mime,
        bytes: data.length,
        sha256: [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
        name,
        created: new Date().toISOString(),
        ...imageSize(data),
      };
      return { id, asset };
    },
    importUrl: () => notImplemented('Importing an image from the web'),
    importClip: () => notImplemented("Importing Word's clipboard images"),
  };
}
