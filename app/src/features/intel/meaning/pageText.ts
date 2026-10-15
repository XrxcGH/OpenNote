// A page's words, as paragraphs for the vector index. Only text blocks count: their Markdown is stripped to plain
// words, and runs of short lines are joined so a paragraph carries enough to mean something. Titles are kept apart.
import type { PageJson } from '../../../services/pages/types';

export interface PageChunk {
  block: string | null;
  text: string;
}

/** The most characters in a paragraph, and the least before it is joined to the next. */
export const CHUNK_MAX = 500;
export const CHUNK_MIN = 80;

/** Markdown as the words a person would read. */
export function plainMarkdown(markdown: string): string {
  // Escaped marks are held aside, so `\*` stays a star while the emphasis marks go.
  const held: string[] = [];
  const stripped = markdown
    .replace(/\\$/gm, '')
    .replace(/\\([!-/:-@[-`{-~])/g, (_all, mark: string) => {
      held.push(mark);
      return '';
    })
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_all, target: string, label?: string) => label ?? target)
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/^\s*\[![\w-]*\][+-]?[ \t]*/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return stripped.replace(//g, () => held.shift() ?? '');
}

/** Cuts long text at sentence ends, so no paragraph is longer than `max`. */
function cut(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let current = '';
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (current && current.length + sentence.length + 1 > max) {
      out.push(current);
      current = '';
    }
    current = current ? `${current} ${sentence}` : sentence;
    while (current.length > max) {
      out.push(current.slice(0, max));
      current = current.slice(max);
    }
  }
  if (current) out.push(current);
  return out;
}

/** The paragraphs of a page, in order, each with the block it came from. */
export function chunksOfPage(page: Pick<PageJson, 'blocks'>): PageChunk[] {
  const chunks: PageChunk[] = [];
  const ordered = [...page.blocks].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  for (const block of ordered) {
    const markdown = block.type === 'text' ? block.data['markdown'] : null;
    if (typeof markdown !== 'string') continue;
    for (const paragraph of markdown.split(/\n\s*\n/)) {
      const text = plainMarkdown(paragraph);
      if (!/[\p{L}\p{N}]/u.test(text)) continue;
      for (const piece of cut(text, CHUNK_MAX)) {
        const last = chunks.at(-1);
        // A short paragraph joins the one before it when they fit together, so a heading stays with its text.
        if (last && last.text.length < CHUNK_MIN && last.text.length + piece.length < CHUNK_MAX) {
          last.text = `${last.text} ${piece}`;
        } else {
          chunks.push({ block: block.id, text: piece });
        }
      }
    }
  }
  return chunks;
}
