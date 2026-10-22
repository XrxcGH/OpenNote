// Page export through the shell (Phase 6): the hidden print window, the Save dialog, and the file writer. The files
// go to Rust as one raw body, with their paths and lengths in a percent-encoded header (paths may hold any letter),
// so a PDF never becomes base64 text.
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { ExportsClient, PrintReceipt, ReplaceReceipt } from '../types';
import { invoke, toIpcError } from './invoke';

export function createTauriExports(): ExportsClient {
  return {
    printPrepare: (job, input) => invoke('print_prepare', { job, input }),
    async printRender(job, size, background, options) {
      const bytes = await invoke('print_render', {
        job,
        width: size.width,
        height: size.height,
        background,
        tagged: options?.tagged ?? false,
        outline: options?.outline ?? false,
      });
      return new Uint8Array(bytes);
    },
    printClose: async (job) => void (await invoke('print_close', { job })),
    async selectionDocx(png, facts) {
      try {
        const bytes = await tauriInvoke<ArrayBuffer>('export_selection_docx', png, {
          headers: { 'x-opennote-docx': encodeURIComponent(JSON.stringify(facts)) },
        });
        return new Uint8Array(bytes);
      } catch (error) {
        throw toIpcError(error);
      }
    },
    printers: () => invoke('print_printers'),
    async printSubmit(pdf, request) {
      try {
        return await tauriInvoke<PrintReceipt>('print_submit', pdf, {
          headers: { 'x-opennote-print': encodeURIComponent(JSON.stringify(request)) },
        });
      } catch (error) {
        throw toIpcError(error);
      }
    },
    pickSave: (request) => invoke('export_pick_save', request),
    open: async (path, reveal) => void (await invoke('export_open', { path, reveal })),
    async write(path, files) {
      await send('export_write', path, files);
    },
    async replace(path, files) {
      return send<ReplaceReceipt>('export_replace', path, files);
    },
    undoReplace: async (path) => void (await invoke('export_undo_replace', { path })),
  };
}

/** Sends the files as one raw body, with their paths and lengths in the header. */
async function send<T = void>(
  command: string,
  path: string,
  files: readonly { path: string; bytes: Uint8Array }[],
): Promise<T> {
  const body = new Uint8Array(files.reduce((sum, file) => sum + file.bytes.length, 0));
  let offset = 0;
  for (const file of files) {
    body.set(file.bytes, offset);
    offset += file.bytes.length;
  }
  const parts = files.map((file, index) => ({ path: index === 0 ? '' : file.path, length: file.bytes.length }));
  try {
    return await tauriInvoke<T>(command, body, {
      headers: { 'x-opennote-export': encodeURIComponent(JSON.stringify({ path, parts })) },
    });
  } catch (error) {
    throw toIpcError(error);
  }
}
