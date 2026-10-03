// The vector index beside the text index (Phase 12): a vector for each paragraph of each page, so a question or a
// page can find the pages about the same thing. It lives in memory and is saved to this device. Pages the caller
// marks protected are never added, and a page that becomes protected is removed.
import { DIM, embed, similarity } from './embed';
import type { Embedder } from './embed';

export interface IndexedChunk {
  /** The block the paragraph came from, when the source knows it. */
  block: string | null;
  text: string;
  vector: Float32Array;
}

export interface IndexedPage {
  id: string;
  title: string;
  /** When the page last changed, as the tree reported it, to tell whether the entry is stale. */
  modified: string;
  chunks: IndexedChunk[];
  titleVector: Float32Array;
  /** The mean of the chunk vectors, scaled to length 1. */
  centroid: Float32Array;
}

export interface PageHit {
  pageId: string;
  title: string;
  score: number;
  /** The paragraph that matched best. */
  chunk: { block: string | null; text: string } | null;
}

export interface PageInput {
  id: string;
  title: string;
  modified: string;
  chunks: readonly { block: string | null; text: string }[];
}

/** The least score a match needs to be listed. */
export const MIN_SCORE = 0.12;
/** The most text kept for one paragraph. */
export const MAX_CHUNK_CHARS = 600;

function unit(sum: Float32Array): Float32Array {
  let norm = 0;
  for (const v of sum) norm += v * v;
  const length = Math.sqrt(norm);
  if (length === 0) return sum;
  return sum.map((v) => v / length);
}

export function createVectorIndex(embedder: Embedder = { name: 'built in', dim: DIM, embed }) {
  const pages = new Map<string, IndexedPage>();
  let isProtected: (id: string) => boolean = () => false;

  const build = (input: PageInput): IndexedPage => {
    const chunks = input.chunks
      .filter((chunk) => chunk.text.trim() !== '')
      .map((chunk) => {
        const text = chunk.text.slice(0, MAX_CHUNK_CHARS);
        return { block: chunk.block, text, vector: embedder.embed(text) };
      });
    const sum = new Float32Array(embedder.dim);
    for (const chunk of chunks) chunk.vector.forEach((v, i) => (sum[i] = (sum[i] ?? 0) + v));
    return {
      id: input.id,
      title: input.title,
      modified: input.modified,
      chunks,
      titleVector: embedder.embed(input.title),
      centroid: unit(sum),
    };
  };

  return {
    embedder,
    /** Decides which pages are never indexed, such as the pages of a locked section. */
    setProtectedCheck(check: (id: string) => boolean): void {
      isProtected = check;
      for (const id of [...pages.keys()]) if (check(id)) pages.delete(id);
    },
    /** Adds or replaces a page. A protected page is refused, and false comes back. */
    set(input: PageInput): boolean {
      if (isProtected(input.id)) return false;
      pages.set(input.id, build(input));
      return true;
    },
    /** Puts back a page that was saved, with its vectors as they were. */
    restore(page: IndexedPage): void {
      if (!isProtected(page.id)) pages.set(page.id, page);
    },
    remove: (id: string): boolean => pages.delete(id),
    has: (id: string): boolean => pages.has(id),
    get: (id: string): IndexedPage | undefined => pages.get(id),
    modifiedOf: (id: string): string | null => pages.get(id)?.modified ?? null,
    ids: (): string[] => [...pages.keys()],
    get size(): number {
      return pages.size;
    },
    all: (): IndexedPage[] => [...pages.values()],
    clear: (): void => pages.clear(),

    /** The pages best matching the vector, best first. A page scores by its best paragraph or by its title. */
    search(query: Float32Array, options: { limit?: number; exclude?: string } = {}): PageHit[] {
      const hits: PageHit[] = [];
      for (const page of pages.values()) {
        if (page.id === options.exclude) continue;
        let best: IndexedChunk | null = null;
        let bestScore = 0;
        for (const chunk of page.chunks) {
          const score = similarity(query, chunk.vector);
          if (score > bestScore) {
            best = chunk;
            bestScore = score;
          }
        }
        const fromTitle = similarity(query, page.titleVector);
        const score = Math.max(bestScore, 0.8 * fromTitle + 0.2 * bestScore);
        if (score >= MIN_SCORE) {
          hits.push({
            pageId: page.id,
            title: page.title,
            score,
            chunk: best ? { block: best.block, text: best.text } : null,
          });
        }
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 10);
    },

    /** The pages most like this one, best first. */
    related(id: string, limit = 8): PageHit[] {
      const page = pages.get(id);
      if (!page || page.chunks.length === 0) return [];
      return this.search(page.centroid, { limit, exclude: id }).filter((hit) => hit.score >= 0.2);
    },
  };
}

export type VectorIndex = ReturnType<typeof createVectorIndex>;
