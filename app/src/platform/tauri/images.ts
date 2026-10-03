// Image import through the shell, which probes each image with Windows Imaging Component and stores it in the
// page's assets (owner after WP0: WP5). Bytes go as a raw body, with the page, name, and type in a header.
import type { ImportedAsset } from '../../services/pages/types';
import type { ImagesClient } from '../types';
import { invoke, invokeBody } from './invoke';

export function createTauriImages(): ImagesClient {
  return {
    importBytes: (page, bytes, name, mime) =>
      invokeBody<ImportedAsset>('image_import', bytes, 'x-opennote-image', { page, name, mime }),
    importUrl: (page, url) => invoke('image_import_url', { page, url }),
    importClip: (page, token) => invoke('image_import_clip', { page, token }),
  };
}
