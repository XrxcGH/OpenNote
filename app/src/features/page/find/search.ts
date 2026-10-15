// Find on the page as a whole: the matches in every text box in reading order, their highlights, and replacing
// them. The text comes from each box as it is now (the editor's, or the last text drawn), never from the layer's
// copy of the block, which is out of date while someone types. Highlights use the CSS Custom Highlight API, so
// they sit over the editors and the static text alike without changing either.
import { unfoldAroundDom } from '../../../editor/commands/fold';
import { serializeTextBlock } from '../../../editor/markdown';
import type { BlockId, Edit } from '../../../services/pages/types';
import { liveText } from '../blocks/textBlock';
import type { LazyBlockView } from '../blocks/textBlock';
import type { MountedPage } from '../mount';
import { readingLock } from '../qol/stores';
import { LEAF, matchesInDoc, replaceInDoc } from './match';
import type { DocMatch, FindOptions } from './match';

export interface FindMatch extends DocMatch {
  block: BlockId;
}

/** Every match on the page, in reading order. */
export function collectMatches(mounted: MountedPage, query: string, options: FindOptions): FindMatch[] {
  if (query === '') return [];
  const found: FindMatch[] = [];
  for (const block of mounted.layer.blocks()) {
    if (block.type !== 'text') continue;
    const live = liveText(mounted.layer.view(block.id));
    if (!live) continue;
    for (const match of matchesInDoc(live.liveDoc(), query, options)) found.push({ ...match, block: block.id });
  }
  return found;
}

/** The textblock elements of a text box, in document order: the same order the matches count them in. */
const TEXTBLOCKS = 'p, h1, h2, h3, h4, h5, h6, pre, [data-callout-title]';
/** Nodes that count as one character of text but draw something else. */
const ATOMS = 'br, img, [data-math], [data-math-block]';

/** A DOM range over characters `start` to `end` of an element, counting atoms as one character like the document. */
export function rangeIn(element: HTMLElement, start: number, end: number): Range | null {
  type Point = { node: Node; at: number };
  let offset = 0;
  let from: Point | null = null;
  let to: Point | null = null;
  const beside = (node: Element, after: boolean): Point => {
    const parent = node.parentNode as Node;
    return { node: parent, at: Array.prototype.indexOf.call(parent.childNodes, node) + (after ? 1 : 0) };
  };
  // Returns true once the end of the range is found.
  const visit = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.nodeValue?.length ?? 0;
      if (!from && start < offset + length) from = { node, at: start - offset };
      if (from && end <= offset + length) {
        to = { node, at: end - offset };
        return true;
      }
      offset += length;
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const child = node as Element;
    if (child.matches(ATOMS)) {
      if (!from && start < offset + 1) from = beside(child, false);
      if (from && end <= offset + 1) {
        to = beside(child, true);
        return true;
      }
      offset += 1;
      return false;
    }
    for (const next of Array.from(child.childNodes)) if (visit(next)) return true;
    return false;
  };
  visit(element);
  if (!from || !to) return null;
  const range = element.ownerDocument.createRange();
  try {
    range.setStart((from as Point).node, (from as Point).at);
    range.setEnd((to as Point).node, (to as Point).at);
  } catch {
    return null;
  }
  return range;
}

/** The DOM range of a match, or null when its text box isn't drawn. */
export function rangeOf(mounted: MountedPage, match: FindMatch): Range | null {
  const view = mounted.layer.view(match.block);
  const root = view?.editRoot;
  if (!root) return null;
  const element = root.querySelectorAll<HTMLElement>(TEXTBLOCKS)[match.textblock];
  return element ? rangeIn(element, match.start, match.end) : null;
}

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights ?? null;
}

export const FIND_HIGHLIGHT = 'opennote-find';
export const ACTIVE_HIGHLIGHT = 'opennote-find-active';

/** Draws the matches, with the current one stronger. Returns the current match's range, if it is drawn. */
export function highlight(mounted: MountedPage, matches: readonly FindMatch[], current: number): Range | null {
  const highlights = registry();
  const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!highlights || !Highlight) return matches[current] ? rangeOf(mounted, matches[current]) : null;
  const all: Range[] = [];
  let active: Range | null = null;
  matches.forEach((match, index) => {
    const range = rangeOf(mounted, match);
    if (!range) return;
    if (index === current) active = range;
    else all.push(range);
  });
  highlights.set(FIND_HIGHLIGHT, new Highlight(...all));
  if (active) highlights.set(ACTIVE_HIGHLIGHT, new Highlight(active));
  else highlights.delete(ACTIVE_HIGHLIGHT);
  return active;
}

export function clearHighlights(): void {
  registry()?.delete(FIND_HIGHLIGHT);
  registry()?.delete(ACTIVE_HIGHLIGHT);
}

/** Brings a match into view, drawing its text box first when it is far down a long page. */
export function reveal(mounted: MountedPage, match: FindMatch): void {
  const view = mounted.layer.view(match.block) as Partial<LazyBlockView> | null;
  view?.render?.();
  const range = rangeOf(mounted, match);
  const target = range?.startContainer instanceof Element ? range.startContainer : range?.startContainer.parentElement;
  if (target) unfoldAroundDom(target);
  (target ?? view?.element)?.scrollIntoView?.({ block: 'center' });
}

/** Whether `match` still holds the text it was found with. */
function stillThere(mounted: MountedPage, match: FindMatch, found: string): boolean {
  const live = liveText(mounted.layer.view(match.block));
  return !!live && live.liveDoc().textBetween(match.from, match.to, '', LEAF).toLowerCase() === found.toLowerCase();
}

/**
 * Replaces matches in every box they are in, as one change to the page, so one Ctrl+Z puts them all back. A box
 * that has an editor mounted goes back to static text for a moment and shows the new text; the next click or key
 * mounts it again. Returns how many matches changed.
 */
export async function replaceMatches(
  mounted: MountedPage,
  matches: readonly FindMatch[],
  found: string,
  replacement: string,
): Promise<number> {
  if (mounted.page.readOnly || readingLock.get() || matches.length === 0) return 0;
  await mounted.sync.flushAll('command');
  const byBlock = new Map<BlockId, FindMatch[]>();
  for (const match of matches) {
    if (!stillThere(mounted, match, found)) continue;
    byBlock.set(match.block, [...(byBlock.get(match.block) ?? []), match]);
  }
  const edits: Edit[] = [];
  const changed: { block: BlockId; markdown: string }[] = [];
  let count = 0;
  for (const [block, list] of byBlock) {
    const live = liveText(mounted.layer.view(block));
    if (!live) continue;
    const markdown = serializeTextBlock(replaceInDoc(live.liveDoc(), list, replacement), mounted.cache);
    edits.push({ edit: 'setText', block, markdown });
    changed.push({ block, markdown });
    count += list.length;
  }
  if (edits.length === 0) return 0;
  await mounted.sync.send({ edits });
  for (const { block, markdown } of changed) {
    mounted.pool.demote(block);
    const current = mounted.layer.block(block);
    if (current) mounted.layer.upsert({ ...current, data: { ...current.data, markdown } });
  }
  return count;
}
