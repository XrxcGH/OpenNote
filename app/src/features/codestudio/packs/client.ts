// The desktop shell's pack commands (app/src-tauri/src/packs/mod.rs). In a browser there is no shell, so nothing
// can download, and the client is null.
import type { PackId, PackList } from '../contracts';

export interface PacksClient {
  list(): Promise<PackList>;
  download(pack: PackId): Promise<void>;
  cancel(pack: PackId): Promise<void>;
  remove(pack: PackId): Promise<void>;
}

export function shellPacksClient(): PacksClient | null {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;
  const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args);
  };
  return {
    list: () => call<PackList>('packs_list'),
    download: (pack) => call<void>('packs_download', { pack }),
    cancel: (pack) => call<void>('packs_cancel', { pack }),
    remove: (pack) => call<void>('packs_remove', { pack }),
  };
}

/** The error code of a rejected call, or `unknown`. */
export function errorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

/**
 * The address a worker fetches a pack file from. WebView2 reaches a custom scheme as `http://<scheme>.localhost`;
 * other platforms use the scheme itself. Only verified files answer (ADR 0070).
 */
export function packFileUrl(file: string, windows = isWindows()): string {
  const path = file.replace(/^\/+/, '');
  return windows ? `http://opennote-pack.localhost/${path}` : `opennote-pack://localhost/${path}`;
}

function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);
}
