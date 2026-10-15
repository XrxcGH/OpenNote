// Handwriting and transcripts for search (Phase 12, A1-30, and A4-6). The page's ink is read on this device, in the
// background, and the words go to the index under one block that stands for the page's ink; a transcript block's
// lines go in under the block itself, with the speakers' names. The words and their boxes stay in memory, so a hit
// can be marked on the ink. Nothing here asks the person anything, and a page in a locked section keeps no words,
// because the index forgets them.
import type { InkStroke, Rect } from '../../../services/intel';
import type { MediaKind } from '../../../services/search/types';

/** The ID that stands for a page's ink in the index: a valid block ID that no real block has. */
export const INK_BLOCK = '0hand0000000000000000000000';
export const TRANSCRIPT_TYPE = 'ext:org.opennote/transcript';
const MIN_TERM = 2;
/** The most boxes marked at once, so a common word doesn't cover the page. */
export const MAX_MARKS = 60;

export interface InkWord {
  text: string;
  bounds: Rect;
}

export interface InkRead {
  text: string;
  words: InkWord[];
}

export interface HandwritingDeps {
  strokes(): { id: string; points: readonly { x: number; y: number }[] }[];
  read(strokes: InkStroke[]): Promise<InkRead | null>;
  index(entry: { page: string; block: string; kind: MediaKind; text: string }): Promise<boolean>;
}

const words = new Map<string, InkWord[]>();
const signatures = new Map<string, string>();

/** A short fingerprint of the ink, so a page is read again only when its strokes changed. */
export function inkSignature(strokes: readonly { id: string; points: readonly unknown[] }[]): string {
  return strokes.map((stroke) => `${stroke.id}:${stroke.points.length}`).join('|');
}

/** Reads the page's ink if it changed since last time and hands the words to the index. */
export async function indexInk(page: string, deps: HandwritingDeps): Promise<boolean> {
  const strokes = deps.strokes();
  const signature = inkSignature(strokes);
  if (signatures.get(page) === signature) return false;
  if (strokes.length === 0) {
    signatures.set(page, signature);
    words.delete(page);
    return deps.index({ page, block: INK_BLOCK, kind: 'handwriting', text: '' });
  }
  const read = await deps.read(
    strokes.map((stroke) => ({ key: stroke.id, points: stroke.points.map((p): [number, number] => [p.x, p.y]) })),
  );
  if (!read) return false;
  signatures.set(page, signature);
  words.set(page, read.words);
  return deps.index({ page, block: INK_BLOCK, kind: 'handwriting', text: read.text.trim() });
}

/** Whether this session has read the page's ink, so that cleared ink is also forgotten. */
export const inkKnown = (page: string): boolean => signatures.has(page);

/** The words read from a page's ink in this session. */
export function inkWordsOf(page: string): readonly InkWord[] {
  return words.get(page) ?? [];
}

/** The search words of a query, in lower case. */
export function termsOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= MIN_TERM);
}

/** The recognized words that hold one of the query's words. */
export function matchingWords(all: readonly InkWord[], query: string): InkWord[] {
  const terms = termsOf(query);
  if (terms.length === 0) return [];
  return all.filter((word) => terms.some((term) => word.text.toLowerCase().includes(term))).slice(0, MAX_MARKS);
}

/** The text of a transcript block's data: its lines with the speakers' names, one line each. */
export function transcriptText(data: Record<string, unknown>): string {
  const lines = Array.isArray(data.lines) ? (data.lines as { text?: unknown; speaker?: unknown }[]) : [];
  const names = (data.speakers && typeof data.speakers === 'object' ? data.speakers : {}) as Record<string, unknown>;
  const out: string[] = [];
  if (typeof data.summary === 'string' && data.summary.trim()) out.push(data.summary.trim());
  for (const line of lines) {
    if (typeof line.text !== 'string' || !line.text.trim()) continue;
    const name = typeof line.speaker === 'number' ? names[String(line.speaker)] : undefined;
    out.push(typeof name === 'string' && name.trim() ? `${name.trim()}: ${line.text.trim()}` : line.text.trim());
  }
  return out.join('\n');
}

export function resetHandwritingIndexForTests(): void {
  words.clear();
  signatures.clear();
}
