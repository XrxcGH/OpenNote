// The window's chrome above and below the page: the title bar and the command bar at the top, the word count line
// and the compact bottom bar at the bottom. Panels that float over the page (tool windows, side sheets) sit between
// them, so none covers a toolbar, its divider line, or the status text. Each chrome element registers itself with a
// ref; the measured edges go on the root as --panel-inset-top and --panel-inset-bottom (base.css derives the
// panel bounds from them), and chromeInsets() gives the same numbers to code that places a panel.

export type ChromeEdge = 'top' | 'bottom';

const edges = new Map<Element, ChromeEdge>();
let observer: ResizeObserver | null = null;
let frame = 0;
let insets = { top: 0, bottom: 0 };

/** The space the chrome takes at the top and the bottom of the window, in CSS px. */
export function chromeInsets(): Readonly<{ top: number; bottom: number }> {
  return insets;
}

function measure(): void {
  frame = 0;
  let top = 0;
  let bottom = 0;
  const height = window.innerHeight;
  for (const [element, edge] of edges) {
    const box = element.getBoundingClientRect();
    if (box.height === 0) continue;
    if (edge === 'top') top = Math.max(top, box.bottom);
    else bottom = Math.max(bottom, height - box.top);
  }
  const next = { top: Math.ceil(top), bottom: Math.ceil(bottom) };
  if (next.top === insets.top && next.bottom === insets.bottom) return;
  insets = next;
  const root = document.documentElement.style;
  root.setProperty('--panel-inset-top', `${next.top}px`);
  root.setProperty('--panel-inset-bottom', `${next.bottom}px`);
}

function schedule(): void {
  frame ||= requestAnimationFrame(measure);
}

function track(element: Element, edge: ChromeEdge): () => void {
  edges.set(element, edge);
  if (!observer && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(schedule);
    window.addEventListener('resize', schedule);
  }
  observer?.observe(element);
  measure();
  return () => {
    edges.delete(element);
    observer?.unobserve(element);
    schedule();
  };
}

const refs: Record<ChromeEdge, (element: Element | null) => (() => void) | undefined> = {
  top: (element) => (element ? track(element, 'top') : undefined),
  bottom: (element) => (element ? track(element, 'bottom') : undefined),
};

/** A stable ref callback that registers an element as chrome along one edge of the window. */
export function chromeEdge(edge: ChromeEdge): (element: Element | null) => (() => void) | undefined {
  return refs[edge];
}
