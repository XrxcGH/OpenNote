// The optional full dictionary and thesaurus: Open English WordNet for meanings and Moby Thesaurus II for related words.
// The desktop app downloads both on request, checks them, and builds an index on the device (src-tauri/src/dictionary);
// this is the interface's side of that: asking the shell about it, and reading its index like the bundled chunks.
import type { Chunk, ChunkLoader, RelatedChunk, RelatedLoader } from './types';

export type FullState = 'notInstalled' | 'partial' | 'downloading' | 'building' | 'installed' | 'failed';

export interface FullStatus {
  state: FullState;
  /** Bytes downloaded so far, or on disk from an earlier try. */
  bytes: number;
  /** What the whole download takes. */
  totalBytes: number;
  /** The code of the last failure, for `failed`. */
  error: string | null;
  /** What the index holds, once installed. */
  words: number;
  related: number;
  /** Whether Work offline is on, which stops a download. */
  offline: boolean;
}

/** The shell's side, as the interface sees it. */
export interface FullClient {
  status(): Promise<FullStatus>;
  start(): Promise<FullStatus>;
  cancel(): Promise<FullStatus>;
  remove(): Promise<FullStatus>;
  /** One chunk of the index as JSON text, or null. `set` is `en` for meanings and `thesaurus` for related words. */
  chunk(set: 'en' | 'thesaurus', key: string): Promise<string | null>;
}

/** What the person is told about the download before it starts. */
export const FULL_SOURCES = {
  meanings: 'Open English WordNet 2025',
  meaningsLicense: 'CC BY 4.0',
  related: 'Moby Thesaurus II',
  relatedLicense: 'public domain',
} as const;

/** The desktop shell's client. It is absent in a browser, where nothing can be downloaded. */
export function shellFullClient(): FullClient | null {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>('dictionary_call', { request: { method, params: params ?? null } });
  };
  return {
    status: () => call<FullStatus>('status'),
    start: () => call<FullStatus>('start'),
    cancel: () => call<FullStatus>('cancel'),
    remove: () => call<FullStatus>('remove'),
    chunk: (set, key) => call<string | null>('chunk', { set, key }),
  };
}

/** The error code of a rejected call, or `unknown`. */
export function errorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

function parse<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as T) : null;
  } catch {
    return null;
  }
}

/** Loaders for the installed index. A chunk is read once and kept until the data is removed. */
export function indexLoaders(client: FullClient): { meanings: ChunkLoader; related: RelatedLoader } {
  const held = new Map<string, Promise<unknown>>();
  const read = <T>(set: 'en' | 'thesaurus', key: string): Promise<T | null> => {
    const id = `${set}/${key}`;
    if (!held.has(id)) {
      held.set(
        id,
        client.chunk(set, key).then(
          (text) => parse<T>(text),
          () => {
            held.delete(id);
            return null;
          },
        ),
      );
    }
    return held.get(id) as Promise<T | null>;
  };
  return {
    meanings: (key) => read<Chunk>('en', key),
    related: (key) => read<RelatedChunk>('thesaurus', key),
  };
}

/** The installed words first, and the starter set for a word the installed ones lack. */
export function layered(first: ChunkLoader, second: ChunkLoader): ChunkLoader {
  return async (key) => {
    const [a, b] = await Promise.all([first(key), second(key)]);
    return a && b ? { ...b, ...a } : (a ?? b);
  };
}

export type FailureKey =
  'offline' | 'safeMode' | 'network' | 'checksum' | 'disk' | 'unreadable' | 'stopping' | 'unknown';

const FAILURES: readonly FailureKey[] = [
  'offline',
  'safeMode',
  'network',
  'checksum',
  'disk',
  'unreadable',
  'stopping',
];

/** What a failed download is called for the person: the key of its message. */
export function failureKey(code: string | null): FailureKey {
  return FAILURES.find((one) => one === code) ?? 'unknown';
}
