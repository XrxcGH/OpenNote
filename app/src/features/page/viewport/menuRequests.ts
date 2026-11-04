// Opens the page's context menu for a touch long press and a pen's barrel button. Chromium raises a contextmenu
// event for these only when Windows press and hold is on, so the page asks for one itself: it dispatches a
// contextmenu event under the press, and the page's menus (the object, text, table, and empty-page menus) answer it
// as they answer a right-click. A press that also raises a native event opens one menu: whichever comes first wins,
// and the other is dropped within `DUPLICATE_MS`.

/** A second request this soon after the first is the same press. */
const DUPLICATE_MS = 400;

let last = Number.NEGATIVE_INFINITY;

const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());

/** Records that a menu was requested just now, and returns whether one was requested a moment ago. */
export function menuRecentlyRequested(): boolean {
  const recent = now() - last < DUPLICATE_MS;
  last = now();
  return recent;
}

/**
 * Raises a contextmenu event at a point of the page, unless a menu was requested a moment ago. `fallback` is the
 * element the press began on, used when nothing is found at the point (a pointer that has left the window).
 */
export function requestContextMenu(doc: Document, x: number, y: number, fallback: EventTarget | null): void {
  if (menuRecentlyRequested()) return;
  const found = doc.elementFromPoint?.(x, y) ?? null;
  const target = found ?? (fallback instanceof Element ? fallback : null);
  if (!target) return;
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
}

/**
 * Drops a native contextmenu event that arrives right after the page asked for one (or the other way round), so a
 * long press or barrel press opens one menu. Listens in the capture phase on `element`; returns a function that stops.
 */
export function dropDuplicateMenus(element: HTMLElement): () => void {
  const onMenu = (event: MouseEvent) => {
    // The page's own request is let through; it has already recorded itself.
    if (!event.isTrusted) return;
    if (!menuRecentlyRequested()) return;
    event.preventDefault();
    event.stopPropagation();
  };
  element.addEventListener('contextmenu', onMenu, { capture: true });
  return () => element.removeEventListener('contextmenu', onMenu, { capture: true });
}
