// Syllable marks on the page view. The note's text is not touched: the editor's text nodes stay as they are, and the
// browser paints a color over every second syllable of the long words through the CSS Custom Highlight API. A page
// whose browser lacks the API shows no marks. The marks are a setting of this device and never reach the note, the
// print, or the clipboard.
import { alternateSpans } from '../reading/marks';

/** The name of the highlight, and of the `::highlight()` rule that colors it. */
export const HIGHLIGHT = 'opennote-syllable';
const STYLE_ID = 'opennote-syllable-style';
/** The most syllables marked on a page, so a very long page stays light. */
export const MAX_MARKS = 6000;
const QUIET_MS = 200;

interface Highlights {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

/** The browser's highlight registry and its `Highlight` class, or null where they are missing. */
function support(): { registry: Highlights; make: (ranges: Range[]) => unknown } | null {
  const registry = (globalThis.CSS as unknown as { highlights?: Highlights } | undefined)?.highlights;
  const Highlight = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  return registry && Highlight ? { registry, make: (ranges) => new Highlight(...ranges) } : null;
}

/** Text nodes of the page's prose, leaving out code, which has no syllables. */
function textNodes(root: HTMLElement): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('pre, code, [data-pg-spacer]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const out: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node as Text);
  return out;
}

/** The ranges of the marked syllables in the text under `root`. */
export function markedRanges(root: HTMLElement, language = 'en', limit = MAX_MARKS): Range[] {
  const doc = root.ownerDocument;
  const ranges: Range[] = [];
  for (const node of textNodes(root)) {
    for (const span of alternateSpans(node.data, language)) {
      if (ranges.length >= limit) return ranges;
      const range = doc.createRange();
      range.setStart(node, span.start);
      range.setEnd(node, span.end);
      ranges.push(range);
    }
  }
  return ranges;
}

export interface SyllableMarks {
  /** Turns the marks on or off. */
  set(on: boolean): void;
  stop(): void;
}

/** Paints the marks over the text of `root` while they are on, and again after the text changes. */
export function attachSyllables(root: HTMLElement, language = 'en'): SyllableMarks {
  const doc = root.ownerDocument;
  const found = support();
  let on = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const paint = () => {
    timer = undefined;
    if (!found) return;
    if (!on) return void found.registry.delete(HIGHLIGHT);
    found.registry.set(HIGHLIGHT, found.make(markedRanges(root, language)));
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(paint, QUIET_MS);
  };
  const mutations = typeof MutationObserver === 'undefined' || !found ? null : new MutationObserver(later);

  return {
    set(next) {
      if (next === on || !found) return;
      on = next;
      if (on) {
        let style = doc.getElementById(STYLE_ID);
        if (!style) {
          style = doc.createElement('style');
          style.id = STYLE_ID;
          style.textContent = `::highlight(${HIGHLIGHT}) { color: var(--color-accent-night); }`;
          doc.head.append(style);
        }
        mutations?.observe(root, { childList: true, subtree: true, characterData: true });
      } else mutations?.disconnect();
      paint();
    },
    stop() {
      clearTimeout(timer);
      mutations?.disconnect();
      found?.registry.delete(HIGHLIGHT);
      on = false;
    },
  };
}
