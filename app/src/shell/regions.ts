// The shell's regions, in F6 order (ARCHITECTURE.md section 11.6). Each remembers the last focused element, so
// focus can go back to it, else to the region's main control, never to <body>. WP5 adds the F6 commands and
// the focus rules for layout changes.

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

function remember(id: RegionId, element: HTMLElement) {
  const onFocusIn = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement) remembered.set(id, event.target);
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

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Moves focus into a region. Returns false when the region isn't showing or has nothing to focus. */
export function focusRegion(id: RegionId, target: 'remembered' | 'main' = 'remembered'): boolean {
  const region = elements.get(id);
  if (!region?.isConnected) return false;
  const last = remembered.get(id);
  const candidates = [
    target === 'remembered' && last?.isConnected && region.contains(last) ? last : null,
    mains.get(id)?.() ?? null,
    region.querySelector<HTMLElement>(FOCUSABLE),
  ];
  const next = candidates.find((element): element is HTMLElement => element !== null);
  next?.focus();
  return next !== undefined && document.activeElement === next;
}
