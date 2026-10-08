// Native help for the typed-notes extras through the shell: the Windows text cursor settings, link titles, and
// attached files that open in their own app and save back. File bytes go as a raw body with a JSON header.
import type { ImportedAsset } from '../../services/pages/types';
import type { PageExtrasClient } from '../types';
import { invoke, invokeBody, listen } from './invoke';

export function createTauriPageExtras(): PageExtrasClient {
  return {
    caretMetrics: () => invoke('page_extras_caret'),
    linkTitle: (url) => invoke('page_extras_link_title', { url }),
    attachBytes: (page, bytes, name, mime) =>
      invokeBody<ImportedAsset>('attachment_import', bytes, 'x-opennote-attachment', {
        page,
        name: encodeURIComponent(name),
        mime,
      }),
    openAttachment: (page, asset, name) => invoke('attachment_open', { page, asset, name }),
    stopAttachments: (page) => invoke('attachment_stop', { page }).then(() => undefined),
    onAttachmentSaved: (listener) => listen('attachment://saved', listener),
  };
}
