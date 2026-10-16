// Saving the vector index on this device and reading it back. Each vector is stored as one signed byte per slot, so a
// paragraph takes about a kilobyte and a large notebook fits in a few megabytes. A file from another version of the
// embedder, or one that doesn't parse, is ignored and the pages are indexed again.
import { DIM } from './embed';
import type { IndexedPage } from './vectorIndex';

interface SavedChunk {
  b: string | null;
  t: string;
  v: string;
}

interface SavedPage {
  id: string;
  title: string;
  modified: string;
  tv: string;
  chunks: SavedChunk[];
}

interface Saved {
  version: 1;
  embedder: string;
  dim: number;
  pages: SavedPage[];
}

export const FILE = 'meaning-index.json';

function pack(vector: Float32Array): string {
  const bytes = new Uint8Array(vector.length);
  vector.forEach((v, i) => {
    bytes[i] = Math.max(-127, Math.min(127, Math.round(v * 127))) & 0xff;
  });
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x2000) text += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(text);
}

function unpack(text: string, dim: number): Float32Array {
  const binary = atob(text);
  if (binary.length !== dim) throw new Error('A vector has the wrong size.');
  const vector = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) {
    const byte = binary.charCodeAt(i);
    vector[i] = (byte > 127 ? byte - 256 : byte) / 127;
  }
  return vector;
}

function unit(vector: Float32Array): Float32Array {
  let norm = 0;
  for (const v of vector) norm += v * v;
  const length = Math.sqrt(norm);
  return length === 0 ? vector : vector.map((v) => v / length);
}

/** The pages as text to save. */
export function serialize(pages: readonly IndexedPage[], embedder: string, dim = DIM): string {
  const saved: Saved = {
    version: 1,
    embedder,
    dim,
    pages: pages.map((page) => ({
      id: page.id,
      title: page.title,
      modified: page.modified,
      tv: pack(page.titleVector),
      chunks: page.chunks.map((chunk) => ({ b: chunk.block, t: chunk.text, v: pack(chunk.vector) })),
    })),
  };
  return JSON.stringify(saved);
}

/** The pages in saved text, or an empty list when it can't be used. */
export function deserialize(text: string, embedder: string, dim = DIM): IndexedPage[] {
  try {
    const saved = JSON.parse(text) as Saved;
    if (saved.version !== 1 || saved.embedder !== embedder || saved.dim !== dim) return [];
    return saved.pages.map((page) => {
      const chunks = page.chunks.map((chunk) => ({ block: chunk.b, text: chunk.t, vector: unpack(chunk.v, dim) }));
      const sum = new Float32Array(dim);
      for (const chunk of chunks) chunk.vector.forEach((v, i) => (sum[i] = (sum[i] ?? 0) + v));
      return {
        id: page.id,
        title: page.title,
        modified: page.modified,
        chunks,
        titleVector: unpack(page.tv, dim),
        centroid: unit(sum),
      };
    });
  } catch {
    return [];
  }
}
