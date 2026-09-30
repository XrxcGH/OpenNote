// Back and forward return to the earlier scroll position (FEATURES.md, Phase 2, "Back and forward"). The page
// region remembers its scroll offset for each location it showed; a step through history puts the offset back
// once the page has drawn, and opening something new starts at the top.

import { useCallback, useEffect, useRef } from 'react';
import type { RefCallback } from 'react';
import { getLocation, onNavigate } from '../../app/location';
import type { Location } from '../../app/location';

/** Offsets are kept for this many locations, the newest last. */
const REMEMBERED = 100;

const keyOf = (location: Location) => JSON.stringify(location);

export function usePageScrollMemory(regionRef: RefCallback<HTMLElement>): RefCallback<HTMLElement> {
  const element = useRef<HTMLElement | null>(null);
  const offsets = useRef(new Map<string, number>());
  const ref = useCallback(
    (node: HTMLElement | null) => {
      element.current = node;
      if (!node) return;
      const cleanup = regionRef(node);
      const onScroll = () => {
        const map = offsets.current;
        const key = keyOf(getLocation());
        map.delete(key);
        map.set(key, node.scrollTop);
        if (map.size > REMEMBERED) map.delete(map.keys().next().value as string);
      };
      node.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        node.removeEventListener('scroll', onScroll);
        if (typeof cleanup === 'function') cleanup();
      };
    },
    [regionRef],
  );
  useEffect(
    () =>
      onNavigate((navigation) => {
        const saved = offsets.current.get(keyOf(navigation.to));
        const historyStep = navigation.kind === 'back' || navigation.kind === 'forward';
        // Two frames: one for React to draw the page, one for its content to lay out.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (element.current) element.current.scrollTop = historyStep ? (saved ?? 0) : 0;
          }),
        );
      }),
    [],
  );
  return ref;
}
