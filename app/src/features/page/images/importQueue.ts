// The image import queue (Phase 4 ARCHITECTURE.md section 12.2): at most 4 imports at once and at most 64 MB of
// source bytes in flight, so pasting 30 photos never holds them all in memory. Imports by address or by clipboard
// token carry no bytes from the page, so only the concurrency limit holds them.
import type { ImageSource, ImportedAsset } from '../../../services/pages/types';

export const MAX_ACTIVE = 4;
export const MAX_BYTES_IN_FLIGHT = 64 * 1024 * 1024;

export interface ImportQueueState {
  /** Imports waiting or running. */
  pending: number;
  active: number;
  /** Source bytes of the running imports. */
  bytes: number;
}

/** What the queue imports: a source, or a file whose bytes are read only when its turn comes. */
export type QueuedImage = ImageSource | { kind: 'file'; file: Blob; name: string };

export interface ImportQueueOptions {
  run(source: ImageSource, signal?: AbortSignal): Promise<ImportedAsset>;
  maxActive?: number;
  maxBytes?: number;
  onChange?(state: ImportQueueState): void;
}

export interface ImportQueue {
  add(source: QueuedImage, signal?: AbortSignal): Promise<ImportedAsset>;
  state(): ImportQueueState;
}

/** The bytes an import holds while it runs. */
export function sourceBytes(source: QueuedImage): number {
  if (source.kind === 'file') return source.file.size;
  return source.kind === 'bytes' ? source.bytes.byteLength : 0;
}

/** A blob's bytes, through FileReader where Blob.arrayBuffer is missing (older WebViews and jsdom). */
export function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof FileReader === 'undefined') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function loaded(source: QueuedImage): Promise<ImageSource> {
  if (source.kind !== 'file') return source;
  return { kind: 'bytes', bytes: await blobBytes(source.file), name: source.name, mime: source.file.type };
}

interface Job {
  source: QueuedImage;
  signal?: AbortSignal;
  bytes: number;
  resolve(asset: ImportedAsset): void;
  reject(error: unknown): void;
}

const aborted = () => new DOMException('The import was cancelled.', 'AbortError');

export function createImportQueue(options: ImportQueueOptions): ImportQueue {
  const maxActive = options.maxActive ?? MAX_ACTIVE;
  const maxBytes = options.maxBytes ?? MAX_BYTES_IN_FLIGHT;
  const waiting: Job[] = [];
  let active = 0;
  let bytes = 0;
  const state = (): ImportQueueState => ({ pending: waiting.length + active, active, bytes });
  const changed = () => options.onChange?.(state());

  function pump(): void {
    while (waiting.length > 0 && active < maxActive) {
      const next = waiting[0];
      if (next.signal?.aborted) {
        waiting.shift();
        next.reject(aborted());
        continue;
      }
      // One import larger than the budget still runs, alone.
      if (active > 0 && bytes + next.bytes > maxBytes) break;
      waiting.shift();
      start(next);
    }
    changed();
  }

  function start(job: Job): void {
    active += 1;
    bytes += job.bytes;
    loaded(job.source)
      .then((source) => options.run(source, job.signal))
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        bytes -= job.bytes;
        // The bytes are the caller's to drop now; the queue keeps no reference to them.
        job.source = { kind: 'url', url: '' };
        pump();
      });
  }

  return {
    add(source, signal) {
      if (signal?.aborted) return Promise.reject(aborted());
      return new Promise<ImportedAsset>((resolve, reject) => {
        waiting.push({ source, signal, bytes: sourceBytes(source), resolve, reject });
        pump();
      });
    },
    state,
  };
}
