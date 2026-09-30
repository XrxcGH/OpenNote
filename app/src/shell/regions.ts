// The shell's regions, in F6 order (ARCHITECTURE.md section 11.6): title bar, command bar, notebooks, pages, page,
// and the notifications while a toast shows. Each region remembers the last element focused inside it, so F6 and
// layout changes put focus back where it was, else on the region's main control, never on <body>.

import { useCallback } from 'react';
import type { RefCallback } from 'react';

export type RegionId = 'titleBar' | 'commandBar' | 'notebooks' | 'pages' | 'page' | 'notifications';

export const REGION_ORDER: readonly RegionId[] = [
  'titleBar',
  'commandBar',
  'notebooks',
  'pages',
  'page',
  'notifications',
];

const elements = new Map<RegionId, HTMLElement>();
const remembered = new Map<RegionId, HTMLElement>();
const mains = new Map<RegionId, () => HTMLElement | null>();
let lastRegion: RegionId | null = null;

function remember(id: RegionId, element: HTMLElement) {
  const onFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof HTMLElement)) return;
    // A region inside another (the pages overlay inside the workspace) records focus once, for the inner one.
    if (event.target.closest('[data-region]') !== element) return;
    remembered.set(id, event.target);
    lastRegion = id;
  };
  element.addEventListener('focusin', onFocusIn);
  return () => element.removeEventListener('focusin', onFocusIn);
}

/** Marks an element as a region and remembers focus inside it. */
export function useRegion(id: RegionId): { ref: RefCallback<HTMLElement>; 'data-region': RegionId } {
  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      elements.set(id, element);
      const stop = remember(id, element);
      return () => {
        stop();
        if (elements.get(id) === element) elements.delete(id);
      };
    },
    [id],
  );
  return { ref, 'data-region': id };
}

/** Tells the region which control to focus when nothing inside it was focused yet, such as the selected row. */
export function registerRegionMain(id: RegionId, getMain: () => HTMLElement | null): () => void {
  mains.set(id, getMain);
  return () => {
    if (mains.get(id) === getMain) mains.delete(id);
  };
}

const FOCUSABLE = [
  'button, [href], input, select, textarea, summary, iframe, [tabindex]',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

/** Whether an element is on screen and usable: connected, not hidden, not disabled, not inert. */
export function isShown(element: Element | null | undefined): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (element.matches(':disabled') || element.closest('[inert]')) return false;
  return element.checkVisibility ? element.checkVisibility({ visibilityProperty: true }) : true;
}

/** Whether an element is shown and can take focus. */
export function canFocus(element: Element | null | undefined): element is HTMLElement {
  return isShown(element) && element.matches(FOCUSABLE);
}

/**
 * The first control Tab would reach inside an element, passing over pane splitters. While a pane's content is
 * showing, its rail buttons are passed over too. A pane that is still loading rows then has nothing to focus yet,
 * instead of sending focus to the button that opened it.
 */
function firstTabbable(root: HTMLElement): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>(FOCUSABLE);
  const content = root.querySelector<HTMLElement>('[data-pane-content]');
  const skipRail = content !== null && isShown(content);
  const usable = (element: HTMLElement) =>
    element.tabIndex >= 0 &&
    element.getAttribute('role') !== 'separator' &&
    !(skipRail && element.closest('[data-rail]'));
  return [...candidates].find((element) => usable(element) && canFocus(element)) ?? null;
}

/** The region's current item: its selected row, or the row marked current. */
function currentItem(root: HTMLElement): HTMLElement | null {
  const selected = root.querySelectorAll('[aria-selected="true"], [aria-current]:not([aria-current="false"])');
  return [...selected].find(canFocus) ?? null;
}

/** Whether a region is showing: connected, visible, and not inert. */
export function isRegionShowing(id: RegionId): boolean {
  return isShown(elements.get(id));
}

/** The region that holds an element, such as the focused one. */
export function regionOf(element: Element | null): RegionId | null {
  const id = element?.closest('[data-region]')?.getAttribute('data-region');
  return id && REGION_ORDER.includes(id as RegionId) ? (id as RegionId) : null;
}

/** The region focus was last in, even if focus has since moved to <body>. */
export function lastFocusedRegion(): RegionId | null {
  return lastRegion;
}

/** The element focusRegion would focus, or null when the region isn't showing or has nothing to focus. */
export function regionFocusTarget(id: RegionId, target: 'remembered' | 'main'): HTMLElement | null {
  const region = elements.get(id);
  if (!region || !isShown(region)) return null;
  const last = remembered.get(id);
  const candidates = [
    target === 'remembered' && region.contains(last ?? null) ? last : null,
    mains.get(id)?.() ?? null,
    currentItem(region),
    firstTabbable(region),
    // A region with nothing to Tab to, such as a page placeholder, can still take focus itself.
    region.getAttribute('tabindex') === '-1' ? region : null,
  ];
  return candidates.find((element): element is HTMLElement => canFocus(element) && region.contains(element)) ?? null;
}

/** Moves focus into a region. Returns false when the region isn't showing or has nothing to focus. */
export function focusRegion(id: RegionId, target: 'remembered' | 'main' = 'remembered'): boolean {
  const next = regionFocusTarget(id, target);
  next?.focus();
  return next !== null && document.activeElement === next;
}

/** How long focusRegionSoon waits for a pane to draw its rows. */
const SOON_MS = 1000;

/**
 * Moves focus into a region now, or as soon as it has something to focus, for a pane that is still loading its
 * rows. It gives up after a second, or when focus moves somewhere else first. Returns a function that stops it.
 */
export function focusRegionSoon(id: RegionId, target: 'remembered' | 'main' = 'main'): () => void {
  if (focusRegion(id, target)) return () => {};
  const before = document.activeElement;
  const observer = new MutationObserver(() => {
    const moved = document.activeElement !== before && document.activeElement !== document.body;
    if (moved || focusRegion(id, target)) stop();
  });
  const timer = setTimeout(() => stop(), SOON_MS);
  function stop() {
    observer.disconnect();
    clearTimeout(timer);
  }
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  return stop;
}

/** Moves focus to the next (1) or previous (-1) showing region, wrapping around, as F6 and Shift+F6 do. */
export function cycleRegion(direction: 1 | -1): boolean {
  const current = regionOf(document.activeElement) ?? lastRegion;
  const start = current ? REGION_ORDER.indexOf(current) : direction === 1 ? -1 : 0;
  for (let step = 1; step <= REGION_ORDER.length; step += 1) {
    const index = (start + direction * step + REGION_ORDER.length * 2) % REGION_ORDER.length;
    const id = REGION_ORDER[index];
    if (id !== current && focusRegion(id)) return true;
  }
  return false;
}

/** The regions to try, in order, when the one that had focus has gone. */
const FALLBACKS: readonly RegionId[] = ['pages', 'page', 'notebooks', 'commandBar', 'titleBar'];

/**
 * Puts focus back after a layout change: a size class change, a pane collapsing, the drawer closing, or a compact
 * screen change. If the focused element is gone or hidden, focus moves to the main control of the region that held
 * it, then to `prefer`, then to any showing region. Returns true when it moved focus.
 */
export function repairFocus(prefer?: RegionId): boolean {
  if (canFocus(document.activeElement) && document.activeElement !== document.body) return false;
  const order = [lastRegion, prefer, ...FALLBACKS].filter((id): id is RegionId => id !== null && id !== undefined);
  return order.some((id) => focusRegion(id, 'main'));
}
