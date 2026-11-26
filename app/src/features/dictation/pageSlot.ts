// A place above the page for a bar that floats while it is shown: the dictation bar and the live captions set at the
// top. Drawn over the page, they covered the page's title and the first row of the page list, so instead the bar
// sits over the page area alone, and the page area makes room for it at its top while it is shown.
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

/** The space between the bar and the edges of the page area, in CSS pixels. */
const GAP = 8;

/** How much room each shown bar asks for, so two bars at once make room for both. */
const asked = new Map<symbol, number>();
let before: { main: HTMLElement; padding: string } | null = null;

const pageArea = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-workspace] > main');

function makeRoom(): void {
  const main = pageArea();
  const total = [...asked.values()].reduce((sum, height) => sum + height, 0);
  if (before && (before.main !== main || total === 0)) {
    before.main.style.paddingBlockStart = before.padding;
    before = null;
  }
  if (!main || total === 0) return;
  before ??= { main, padding: main.style.paddingBlockStart };
  main.style.paddingBlockStart = `${total}px`;
}

/** Each bar's place in the stack, from the top of the page area. */
function offsetOf(key: symbol): number {
  let offset = 0;
  for (const [other, height] of asked) {
    if (other === key) break;
    offset += height;
  }
  return offset;
}

/**
 * Places a bar over the top of the page area and makes room for it there while `active`. Returns the callback for the
 * bar's outer element and its style. Without a page area (a test, or a screen with no page) the bar keeps the place
 * its own styles give it.
 */
export function usePageTopSlot(active: boolean): {
  attach: (element: HTMLElement | null) => void;
  style: CSSProperties | undefined;
} {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);
  const attach = useCallback((next: HTMLElement | null) => setElement(next), []);
  useEffect(() => {
    const main = active && element ? pageArea() : null;
    if (!main || !element) return;
    const key = Symbol('page top slot');
    const place = () => {
      const area = main.getBoundingClientRect();
      asked.set(key, element.offsetHeight + GAP);
      makeRoom();
      setStyle({
        top: area.top + GAP + offsetOf(key),
        left: area.left + GAP,
        right: Math.max(0, window.innerWidth - area.right) + GAP,
      });
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(main);
    observer?.observe(element);
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      asked.delete(key);
      makeRoom();
      setStyle(undefined);
    };
  }, [active, element]);
  return { attach, style };
}
