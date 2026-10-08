// "Present as slides" (FEATURES.md, Phase 6): a page is split at its headings or at its divider lines, and each part is a
// full-screen slide. The split is derived from the page each time, so nothing on the page changes. The slides follow
// the page's reading order, so they read in the order a screen reader would.

import { htmlOptions, renderBlock, type BlockContext } from '../export/blocks';
import { readingOrder } from '../export/order';
import type { ExportBlock, ExportPage } from '../export/source';
import { escapeAttr, inlineText, parseMarkdown, renderHtml, type Block } from '../export/markdown';

export type SlideSplit = 'headings' | 'dividers' | 'both';

export interface SlideOptions {
  /** What starts a new slide. Default: both. A heading starts a slide, and a divider line ends one. */
  readonly split?: SlideSplit;
  /** The deepest heading level that starts a slide, from 1 to 6. Default 2. */
  readonly headingLevel?: number;
}

/** A piece of a slide: some blocks of a text block's Markdown, or a whole block of another type. */
export type SlidePart =
  | { readonly kind: 'text'; readonly block: string; readonly content: readonly Block[] }
  | { readonly kind: 'block'; readonly block: ExportBlock };

export interface Slide {
  readonly index: number;
  /** The text of the heading that starts the slide, or an empty string when none does. */
  readonly title: string;
  /** The level of that heading, or 0. */
  readonly level: number;
  readonly parts: readonly SlidePart[];
  /** The IDs of the page blocks the slide draws from, in order. */
  readonly blocks: readonly string[];
}

interface Draft {
  title: string;
  level: number;
  parts: SlidePart[];
}

const empty = (draft: Draft): boolean => draft.parts.length === 0 && draft.title === '';

/** The slides of a page. A page with nothing to split gives one slide, and an empty page gives none. */
export function slidesOf(page: ExportPage, options: SlideOptions = {}): Slide[] {
  const split = options.split ?? 'both';
  const depth = Math.min(Math.max(Math.trunc(options.headingLevel ?? 2), 1), 6);
  const byHeading = split !== 'dividers';
  const byDivider = split !== 'headings';
  const drafts: Draft[] = [];
  let current: Draft = { title: '', level: 0, parts: [] };
  const close = (): void => {
    if (!empty(current)) drafts.push(current);
    current = { title: '', level: 0, parts: [] };
  };
  for (const block of readingOrder(page.blocks, page.view.readingOrder)) {
    if (block.type !== 'text') {
      current.parts.push({ kind: 'block', block });
      continue;
    }
    let run: Block[] = [];
    const flush = (): void => {
      if (run.length > 0) current.parts.push({ kind: 'text', block: block.id, content: run });
      run = [];
    };
    for (const part of parseMarkdown(block.markdown)) {
      if (part.type === 'heading' && byHeading && part.level <= depth) {
        flush();
        close();
        current = { title: inlineText(part.content), level: part.level, parts: [] };
        run.push(part);
      } else if (part.type === 'break' && byDivider) {
        flush();
        close();
      } else run.push(part);
    }
    flush();
  }
  close();
  return drafts.map((draft, index) => ({
    index,
    title: draft.title,
    level: draft.level,
    parts: draft.parts,
    blocks: [...new Set(draft.parts.map((p) => (p.kind === 'text' ? p.block : p.block.id)))],
  }));
}

/** The slide that draws from a block, for starting a presentation at the cursor. Falls back to the first slide. */
export function slideOfBlock(slides: readonly Slide[], blockId: string): number {
  const found = slides.findIndex((s) => s.blocks.includes(blockId));
  return found < 0 ? 0 : found;
}

/** The slide `delta` away, kept within the deck. The arrow keys, Page Up and Page Down, and a swipe all use it. */
export function moveSlide(index: number, delta: number, count: number): number {
  return count === 0 ? -1 : Math.min(Math.max(index + delta, 0), count - 1);
}

/** The titles for a slide navigator. A slide without a heading is "Slide n" in the caller's own words. */
export function slideTitles(slides: readonly Slide[], fallback: (n: number) => string): string[] {
  return slides.map((s) => (s.title === '' ? fallback(s.index + 1) : s.title));
}

/** One slide as HTML. The parts render the same way as in the HTML export, so ink, images, and tables look alike. */
export function slideHtml(slide: Slide, cx: BlockContext, label = slide.title): string {
  const body = slide.parts
    .map((part) => (part.kind === 'text' ? renderHtml(part.content, htmlOptions(cx)) : renderBlock(part.block, cx)))
    .join('\n');
  const name = label === '' ? '' : ` aria-label="${escapeAttr(label)}"`;
  return `<section class="slide" data-slide="${slide.index}"${name}>\n${body}\n</section>`;
}
