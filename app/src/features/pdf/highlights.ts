// Highlights on PDF pages (A3-19). A highlight names a run of the page's words by their positions, so it stays on the
// same words at any size, and keeps their text and its color. It lives in the picture block's data, beside the words,
// so it is saved, undone, and copied with the page. This file is plain data, so unit tests cover it.
import { formatLink } from '../search';
import type { BlockJson, Edit, NewBlock } from '../../services/pages/types';
import { newId } from '../../editor/ids';
import { t } from '../../strings/t';
import { cleanBox } from './model';
import type { Box, PdfPageData, StoredWord } from './model';

/** The highlighter colors, named for the brand's art colors they use. */
export const COLORS = ['candle', 'moss', 'night', 'dusk'] as const;
export type HighlightColor = (typeof COLORS)[number];

export interface Highlight {
  id: string;
  color: HighlightColor;
  /** The first and last word, by position in the page's words. */
  from: number;
  to: number;
  text: string;
}

/** The most highlights kept on one page. */
export const MAX_HIGHLIGHTS = 500;

/** The highlights a block keeps, checked. */
export function highlightsOf(block: Pick<BlockJson, 'data'>): Highlight[] {
  const list = block.data.highlights;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is Highlight =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.id === 'string' &&
      COLORS.includes(item.color) &&
      Number.isInteger(item.from) &&
      Number.isInteger(item.to) &&
      item.from >= 0 &&
      item.to >= item.from &&
      typeof item.text === 'string',
  );
}

/** The text of words `from` to `to`, joined by spaces. */
export function wordsText(words: readonly StoredWord[], from: number, to: number): string {
  return words
    .slice(from, to + 1)
    .map((word) => word[4])
    .join(' ');
}

/** One box for each line the words `from` to `to` sit on, so a highlight reads as marker strokes. */
export function linesOf(words: readonly StoredWord[], from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let line: [number, number, number, number] | null = null;
  for (const [x, y, w, h] of words.slice(from, to + 1)) {
    if (line && Math.abs(y - line[1]) <= Math.max(h, line[3] - line[1]) / 2) {
      line = [Math.min(line[0], x), Math.min(line[1], y), Math.max(line[2], x + w), Math.max(line[3], y + h)];
      continue;
    }
    if (line) boxes.push(cleanBox(line[0], line[1], line[2] - line[0], line[3] - line[1]) ?? [0, 0, 0, 0]);
    line = [x, y, x + w, y + h];
  }
  if (line) boxes.push(cleanBox(line[0], line[1], line[2] - line[0], line[3] - line[1]) ?? [0, 0, 0, 0]);
  return boxes.filter(([, , w, h]) => w > 0 && h > 0);
}

/** The data patch that adds a highlight, or null when the page has as many as it keeps. */
export function addHighlight(
  block: Pick<BlockJson, 'data'>,
  words: readonly StoredWord[],
  range: { from: number; to: number },
  color: HighlightColor,
): { patch: Record<string, unknown>; highlight: Highlight } | null {
  const list = highlightsOf(block);
  const from = Math.max(0, Math.min(range.from, range.to));
  const to = Math.min(words.length - 1, Math.max(range.from, range.to));
  if (to < from) return null;
  // The same words again are not marked twice: the mark they have takes the new color.
  const same = list.find((h) => h.from === from && h.to === to);
  if (same) {
    const highlight = { ...same, color };
    return { patch: { highlights: list.map((h) => (h === same ? highlight : h)) }, highlight };
  }
  if (list.length >= MAX_HIGHLIGHTS) return null;
  const highlight: Highlight = { id: newId(), color, from, to, text: wordsText(words, from, to) };
  return { patch: { highlights: [...list, highlight] }, highlight };
}

/** The data patch that changes a highlight's color, or removes it with a null color. */
export function changeHighlight(
  block: Pick<BlockJson, 'data'>,
  id: string,
  color: HighlightColor | null,
): Record<string, unknown> {
  const list = highlightsOf(block);
  return {
    highlights: color === null ? list.filter((h) => h.id !== id) : list.map((h) => (h.id === id ? { ...h, color } : h)),
  };
}

/** The quote "Send to notes" adds: the words, and a link back to the spot with the page number. */
export function quoteMarkdown(highlight: Highlight, pdf: PdfPageData | null, page: string, block: string): string {
  const quote = highlight.text.replace(/\s+/g, ' ').trim();
  const where = pdf ? t('pdf.highlights.pageRef', { page: pdf.page, file: pdf.file }) : t('pdf.highlights.source');
  return `> ${quote}\n>\n> [${where.replace(/[[\]]/g, '')}](${formatLink(page, block)})`;
}

/** The text block "Send to notes" adds beside the picture, level with the highlight. */
export function quoteEdit(
  markdown: string,
  picture: { x: number; y: number; w: number; h: number },
  top: number,
): Edit {
  const block: NewBlock = {
    id: newId() as never,
    type: 'text',
    frame: { x: picture.x + picture.w + 24, y: picture.y + top * picture.h, w: 320 },
    data: { markdown },
  };
  return { edit: 'insertBlock', block };
}

/** One highlight with where it is, for the list of a PDF's highlights. */
export interface FoundHighlight extends Highlight {
  file: string;
  page: number;
  /** The OpenNote page and picture block it is on. */
  node: string;
  block: string;
}

/** The highlights grouped by color in highlighter order, each group sorted by page. */
export function groupHighlights(
  found: readonly FoundHighlight[],
): { color: HighlightColor; items: FoundHighlight[] }[] {
  return COLORS.map((color) => ({
    color,
    items: found.filter((h) => h.color === color).sort((a, b) => a.page - b.page || a.from - b.from),
  })).filter((group) => group.items.length > 0);
}

/** The list as Markdown: a heading for each color, and each highlight as a quote with its page and link. */
export function highlightsMarkdown(title: string, found: readonly FoundHighlight[]): string {
  const lines = [`# ${title}`];
  for (const group of groupHighlights(found)) {
    lines.push('', `## ${t(`pdf.highlights.colors.${group.color}`)}`);
    for (const item of group.items) {
      const where = t('pdf.highlights.pageRef', { page: item.page, file: item.file }).replace(/[[\]]/g, '');
      lines.push(
        '',
        `> ${item.text.replace(/\s+/g, ' ').trim()}`,
        '>',
        `> [${where}](${formatLink(item.node, item.block)})`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
