// The DOM side of spelling squiggles (ARCHITECTURE.md section 16.3; owner: WP7): textblock text, ranges over it, and
// the spelling-error CSS Custom Highlight. It imports nothing from the editor, so static pages and read aloud use it
// without loading Tiptap.
import type { SpellingService } from '../host';

/** UTF-16 offsets into a textblock's checked text. */
export interface SpellRange {
  readonly start: number;
  readonly length: number;
}

/** A textblock's text as the checker sees it, and the DOM text nodes it came from. */
export interface TextblockText {
  readonly text: string;
  readonly nodes: readonly { node: Text; at: number }[];
}

/** The elements whose text is checked: paragraphs, headings, and callout titles. Code blocks never are. */
export const TEXTBLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, [data-callout-title]';
export const HIGHLIGHT_NAME = 'spelling-error';

const SKIPPED = ['ProseMirror-separator', 'ProseMirror-trailingBreak', 'ProseMirror-widget'];
const ADDRESS = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"]+|[^\s@<>"()]+@[^\s@<>"()]+\.[^\s@<>"()]+/gi;

const isAtom = (element: Element) =>
  element.localName === 'br' ||
  element.localName === 'img' ||
  element.hasAttribute('data-math') ||
  element.getAttribute('contenteditable') === 'false';

/**
 * The text of a textblock element, with inline code, math, images, web addresses, and email addresses replaced by
 * spaces, so offsets still line up with the words around them. Each inline atom counts as one character. Read aloud
 * passes `mask` false to keep code and addresses.
 */
export function textblockText(element: Element, mask = true): TextblockText {
  let text = '';
  const nodes: { node: Text; at: number }[] = [];
  const walk = (parent: Node, masked: boolean) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const data = (child as Text).data;
        nodes.push({ node: child as Text, at: text.length });
        text += masked ? ' '.repeat(data.length) : data;
      } else if (child instanceof Element) {
        if (SKIPPED.some((name) => child.classList.contains(name))) continue;
        if (isAtom(child)) text += ' ';
        else walk(child, masked || (mask && child.localName === 'code'));
      }
    }
  };
  walk(element, false);
  return { text: mask ? text.replace(ADDRESS, (match) => ' '.repeat(match.length)) : text, nodes };
}

/** Whether a textblock element is checked: not in a code block or a widget. */
export function isCheckable(element: Element): boolean {
  return !element.closest('pre, [contenteditable="false"]');
}

/** The DOM range over `[start, start + length)` of a textblock's text, or null past its end. */
export function rangeOver(extracted: TextblockText, start: number, length: number): Range | null {
  /** A start prefers the node that begins at a boundary, an end the node that finishes there. */
  const point = (offset: number, end: boolean) => {
    let found: { node: Text; offset: number } | null = null;
    for (const { node, at } of extracted.nodes) {
      const stop = at + node.data.length;
      if (offset >= at && offset <= stop) {
        found = { node, offset: offset - at };
        if (end || offset < stop) return found;
      }
    }
    return found;
  };
  const from = point(start, false);
  const to = point(start + length, true);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

interface Entry {
  text: string;
  errors: readonly SpellRange[];
  ranges: Range[];
  waiting: boolean;
}

function supportsHighlights(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

/** The page's squiggles, by textblock element. */
export class SpellingHighlights {
  private readonly entries = new Map<Element, Entry>();
  private highlight: Highlight | null = null;
  /** The word at the caret isn't flagged until the caret leaves it. */
  private guard: { element: Element; offset: number } | null = null;

  private registry(): Highlight | null {
    if (!supportsHighlights()) return null;
    if (!this.highlight || CSS.highlights.get(HIGHLIGHT_NAME) !== this.highlight) {
      this.highlight = CSS.highlights.get(HIGHLIGHT_NAME) ?? new Highlight();
      this.highlight.type = 'spelling-error';
      CSS.highlights.set(HIGHLIGHT_NAME, this.highlight);
    }
    return this.highlight;
  }

  /** Shows `errors` over the element's text, skipping the guarded word. */
  show(element: Element, extracted: TextblockText, errors: readonly SpellRange[], waiting = false): void {
    this.drop(element);
    const guard = this.guard?.element === element ? this.guard.offset : -1;
    const shown = errors.filter((error) => guard < error.start || guard > error.start + error.length);
    const ranges = shown.flatMap((error) => rangeOver(extracted, error.start, error.length) ?? []);
    const highlight = this.registry();
    ranges.forEach((range) => highlight?.add(range));
    this.entries.set(element, { text: extracted.text, errors, ranges, waiting });
  }

  /**
   * Keeps an element's squiggles in step with an edit until its new text is checked: errors before and after the
   * changed part stay, shifted, and errors in it go.
   */
  carry(element: Element, extracted: TextblockText): void {
    const old = this.entries.get(element);
    if (!old) return this.show(element, extracted, [], true);
    const before = old.text;
    const after = extracted.text;
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    const delta = after.length - before.length;
    const changedEnd = before.length - suffix;
    // A word that touches the change changed too.
    const mapped = old.errors.flatMap((error) => {
      if (error.start + error.length < prefix) return [error];
      if (error.start > changedEnd) return [{ start: error.start + delta, length: error.length }];
      return [];
    });
    this.show(element, extracted, mapped, true);
  }

  /** Re-reads every waiting element whose text now has results. */
  resolve(service: SpellingService): void {
    for (const [element, entry] of [...this.entries]) {
      if (!element.isConnected) this.drop(element, true);
      else if (entry.waiting) this.refresh(element, service, false);
    }
  }

  /** Re-reads every element, as after a change to the personal dictionary or the ignored words. */
  refreshAll(service: SpellingService): void {
    for (const element of [...this.entries.keys()]) {
      if (!element.isConnected) this.drop(element, true);
      else this.refresh(element, service, false);
    }
  }

  /** Shows the element's cached errors, or carries its old ones and asks for a check. */
  refresh(element: Element, service: SpellingService, request: boolean, key?: string): string | null {
    const extracted = textblockText(element);
    const errors = service.errorsFor(extracted.text);
    if (errors) {
      this.show(element, extracted, errors);
      return null;
    }
    const entry = this.entries.get(element);
    if (entry?.text === extracted.text) entry.waiting = true;
    else this.carry(element, extracted);
    if (request) service.requestCheck(key ?? extracted.text, extracted.text);
    return extracted.text;
  }

  setGuard(element: Element | null, offset = -1): void {
    this.guard = element ? { element, offset } : null;
  }

  guarded(): { element: Element; offset: number } | null {
    return this.guard;
  }

  /** The element's text and errors, as last shown. */
  entry(element: Element): { text: string; errors: readonly SpellRange[] } | null {
    return this.entries.get(element) ?? null;
  }

  /** The elements with squiggles inside `root`, in document order. */
  shownIn(root: Element): Element[] {
    return [...this.entries.keys()]
      .filter((element) => element.isConnected && root.contains(element))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }

  /** The shown ranges, for tests and the context menu. */
  ranges(element: Element): readonly Range[] {
    return this.entries.get(element)?.ranges ?? [];
  }

  /** Forgets every element inside `root`, or every element. */
  clear(root?: Element): void {
    for (const element of [...this.entries.keys()]) {
      if (!root || root.contains(element) || !element.isConnected) this.drop(element, true);
    }
  }

  private drop(element: Element, forget = false): void {
    const entry = this.entries.get(element);
    if (!entry) return;
    entry.ranges.forEach((range) => this.highlight?.delete(range));
    entry.ranges = [];
    if (forget) this.entries.delete(element);
  }
}

/** The page's squiggles. There is one page view per window, so one set. */
export const spellingHighlights = new SpellingHighlights();
