// The engineering diagrams' copy of math/svgScale.ts (features may not import each other's files). Keeps an SVG plot's text the same size on screen. The picture scales with its box, so a label set at 11 px in the
// picture's own units shrinks to 6 px in a narrow column. The hook writes --svg-k (picture units per screen pixel,
// kept in a calm range) onto the element; the plot's text and halo sizes multiply by it. It follows the element
// across renders, so a plot that appears late (after a parse) is still measured.
import { useEffect, useRef, type RefObject } from 'react';

const K_MIN = 0.8;
const K_MAX = 1.5;

export function useSvgScale(ref: RefObject<SVGSVGElement | null>, viewBoxWidth: number): void {
  const watched = useRef<{ el: SVGSVGElement; observer: ResizeObserver | null } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || watched.current?.el === el) return;
    watched.current?.observer?.disconnect();
    const apply = () => {
      const width = el.getBoundingClientRect().width;
      if (width <= 0) return;
      el.style.setProperty('--svg-k', Math.min(K_MAX, Math.max(K_MIN, viewBoxWidth / width)).toFixed(3));
    };
    apply();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    observer?.observe(el);
    watched.current = { el, observer };
  });
  useEffect(() => () => watched.current?.observer?.disconnect(), []);
}
