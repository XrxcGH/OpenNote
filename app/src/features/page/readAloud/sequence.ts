// What read aloud reads (ARCHITECTURE.md section 19.2): blocks in reading order, which is DOM order (section 20.1).
// Text blocks by textblock; code blocks as "Code block, 12 lines", then their text if "Read code aloud" is on;
// images by their alt text, skipping decorative ones; tables as "Table", then each row's cells.
import { TEXTBLOCK_SELECTOR, textblockText } from '../../../editor/extensions/spellingText';
import type { TextblockText } from '../../../editor/extensions/spellingText';
import { t } from '../../../strings/t';

/** One utterance. */
export interface ReadItem {
  /** The element to scroll to; for text, the textblock. */
  element: Element;
  text: string;
  /** For text: the textblock's text and nodes, for highlighting words, and where the spoken part starts in it. */
  source: TextblockText | null;
  offset: number;
}

export interface SequenceOptions {
  readCode: boolean;
}

const PARTS = `pre, table, img, ${TEXTBLOCK_SELECTOR}`;

function textItem(element: Element): ReadItem | null {
  const source = textblockText(element, false);
  return source.text.trim() ? { element, text: source.text, source, offset: 0 } : null;
}

function codeItems(pre: Element, options: SequenceOptions): ReadItem[] {
  const code = pre.textContent ?? '';
  const lines = code.replace(/\n$/, '').split('\n').length;
  const label = { element: pre, text: t('readAloud.codeBlock', { count: lines }), source: null, offset: 0 };
  return options.readCode && code.trim() ? [label, { element: pre, text: code, source: null, offset: 0 }] : [label];
}

function tableItems(table: Element): ReadItem[] {
  const rows = [...table.querySelectorAll('tr')].flatMap((row) => {
    const cells = [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.trim() ?? '');
    const text = cells.filter(Boolean).join(', ');
    return text ? [{ element: row, text, source: null, offset: 0 }] : [];
  });
  return [{ element: table, text: t('readAloud.table'), source: null, offset: 0 }, ...rows];
}

function imageItem(image: HTMLImageElement): ReadItem | null {
  const alt = image.getAttribute('alt')?.trim();
  // An empty alt marks a decorative image (ARCHITECTURE.md section 20.2).
  return alt ? { element: image, text: t('readAloud.image', { alt }), source: null, offset: 0 } : null;
}

function itemsOf(part: Element, options: SequenceOptions): ReadItem[] {
  if (part.localName === 'pre') return codeItems(part, options);
  if (part.localName === 'table') return tableItems(part);
  if (part instanceof HTMLImageElement) return [imageItem(part)].filter((item) => item !== null);
  return [textItem(part)].filter((item) => item !== null);
}

/** The block's parts in document order, skipping parts inside a code block or table, which read as one. */
function partsOf(block: Element): Element[] {
  const found = block.matches(PARTS) ? [block] : [];
  return [...found, ...block.querySelectorAll(PARTS)].filter((part) => {
    const container = part.parentElement?.closest('pre, table');
    return !container || !block.contains(container);
  });
}

/** A block with nothing to read inside, such as a placeholder, reads as its name, unless it is an empty text box. */
function blockItems(block: Element, options: SequenceOptions): ReadItem[] {
  const parts = partsOf(block);
  if (parts.length || block.querySelector('[data-scope="editor"]')) {
    return parts.flatMap((part) => itemsOf(part, options));
  }
  const label = block.getAttribute('aria-label') ?? '';
  return label.trim() ? [{ element: block, text: label, source: null, offset: 0 }] : [];
}

/** Everything on the page, in reading order. */
export function readingSequence(world: Element, options: SequenceOptions): ReadItem[] {
  return [...world.querySelectorAll('[data-block-id]')]
    .filter((block) => !block.parentElement?.closest('[data-block-id]'))
    .flatMap((block) => blockItems(block, options));
}

/** A text item cut to `[start, end)` of its textblock's text. */
export function cutItem(item: ReadItem, start: number, end = item.text.length + item.offset): ReadItem | null {
  if (!item.source) return item;
  const from = Math.max(start, item.offset);
  const text = item.source.text.slice(from, end);
  return text.trim() ? { ...item, text, offset: from } : null;
}

/** Where a DOM point falls in a textblock's text, or null outside it. */
function offsetIn(item: ReadItem, node: Node, offset: number): number | null {
  if (!item.source) return null;
  const found = item.source.nodes.find((entry) => entry.node === node);
  if (found) return found.at + offset;
  return node === item.element || item.element.contains(node) ? 0 : null;
}

/** The start of the word around `offset`, so reading from the caret starts on a whole word. */
function wordStart(text: string, offset: number): number {
  let at = offset;
  while (at > 0 && /[\p{L}\p{N}'’-]/u.test(text[at - 1] ?? '')) at -= 1;
  return at;
}

/**
 * What to read for a selection or caret: the selected text, else from the caret's word to the end, else everything.
 */
export function scopedSequence(items: readonly ReadItem[], range: Range | null): ReadItem[] {
  if (!range) return [...items];
  const first = items.findIndex((item) => range.intersectsNode(item.element));
  if (first < 0) return [...items];
  const start = offsetIn(items[first], range.startContainer, range.startOffset) ?? 0;
  if (range.collapsed) {
    const head = cutItem(items[first], wordStart(items[first].source?.text ?? '', start));
    return [...(head ? [head] : []), ...items.slice(first + 1)];
  }
  let last = first;
  while (last + 1 < items.length && range.intersectsNode(items[last + 1].element)) last += 1;
  const picked = items.slice(first, last + 1).map((item, index, all) => {
    const from = index === 0 ? start : 0;
    const end = index === all.length - 1 ? offsetIn(item, range.endContainer, range.endOffset) : null;
    return cutItem(item, from, end ?? undefined);
  });
  return picked.filter((item) => item !== null);
}
