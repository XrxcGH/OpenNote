// The device's fonts and a notebook's named styles, over the shell's commands fonts_list, notebook_styles_get, and
// notebook_styles_set (ADR 0080, ADR 0082). The font list stays on the device: nothing here logs it.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { FontFamily, FontsClient, NotebookStylesClient, NotebookStylesJson } from '../types';
import { toIpcError } from './invoke';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    throw toIpcError(error);
  }
}

export function createTauriFonts(): FontsClient {
  return { list: (refresh = false) => call<readonly FontFamily[]>('fonts_list', { refresh }) };
}

export function createTauriNotebookStyles(): NotebookStylesClient {
  return {
    get: (notebook) => call<NotebookStylesJson>('notebook_styles_get', { notebook }),
    set: (notebook, styles) => call<null>('notebook_styles_set', { notebook, styles }).then(() => undefined),
  };
}
