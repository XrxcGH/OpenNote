// The layout slice (ARCHITECTURE.md sections 5.2, 9.8, and 11): the size class, density, window width, and which
// of the size-dependent panes is open. The person's pane widths and collapsed panes live in the session slice,
// because they are saved; this slice holds what depends on the window and is never saved.
//
// The size class and density are also root attributes, so CSS selects on them.

import { breakpointQueries, sizeClassFor } from '../shell/layout/sizeClass';
import type { SizeClass } from '../shell/layout/sizeClass';
import { createStore, useStore } from './store';

export { sizeClassFor } from '../shell/layout/sizeClass';
export type { SizeClass } from '../shell/layout/sizeClass';
export type Density = 'mouse' | 'touch';

/** Which pane fills the compact layout (ARCHITECTURE.md section 11.4). */
export type CompactScreen = 'notebooks' | 'pages' | 'page';

export interface LayoutState {
  sizeClass: SizeClass;
  density: Density;
  /** The window's inner width in CSS pixels. */
  width: number;
  /** The medium notebooks drawer. */
  drawerOpen: boolean;
  /** The expanded pages overlay. */
  overlayOpen: boolean;
  /** Whether the medium pages pane is hidden; wide and expanded keep their collapsed panes in the session. */
  mediumPagesCollapsed: boolean;
  compactScreen: CompactScreen;
}

const INITIAL: LayoutState = {
  sizeClass: 'wide',
  density: 'mouse',
  width: 1440,
  drawerOpen: false,
  overlayOpen: false,
  mediumPagesCollapsed: false,
  compactScreen: 'notebooks',
};

export const layoutStore = createStore<LayoutState>(INITIAL, 'layout');

export function useLayout<S>(select: (state: LayoutState) => S, equal?: (a: S, b: S) => boolean): S {
  return useStore(layoutStore, select, equal);
}

export function useSizeClass(): SizeClass {
  return useStore(layoutStore, (state) => state.sizeClass);
}

export function useDensity(): Density {
  return useStore(layoutStore, (state) => state.density);
}

export function getSizeClass(): SizeClass {
  return layoutStore.get().sizeClass;
}

export function getDensity(): Density {
  return layoutStore.get().density;
}

export function setDensity(density: Density): void {
  layoutStore.set((state) => (state.density === density ? state : { ...state, density }));
  document.documentElement.dataset.density = density;
}

/** Sets the size class. Leaving a size class closes its drawer or overlay, which only it has. */
export function setSizeClass(sizeClass: SizeClass): void {
  layoutStore.set((state) =>
    state.sizeClass === sizeClass ? state : { ...state, sizeClass, drawerOpen: false, overlayOpen: false },
  );
  document.documentElement.dataset.sizeClass = sizeClass;
}

/** Changes part of the layout slice, keeping the same state object when nothing changed. */
export function updateLayout(patch: Partial<Omit<LayoutState, 'sizeClass' | 'density'>>): void {
  layoutStore.set((state) => {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    return keys.some((key) => patch[key] !== state[key]) ? { ...state, ...patch } : state;
  });
}

/**
 * Follows the window: the size class from three min-width media queries built from the breakpoint tokens, and the
 * width for the pane solver, at most once per animation frame. Density starts from the primary pointer; WP3's
 * density controller takes over from there. Returns a function that stops following.
 */
export function initLayout(view: Window = window): () => void {
  let frame = 0;
  const measure = () => {
    frame = 0;
    setSizeClass(sizeClassFor(view.innerWidth));
    updateLayout({ width: view.innerWidth });
  };
  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(measure);
  };
  measure();
  setDensity(view.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'mouse');
  const queries = view.matchMedia ? breakpointQueries().map((media) => view.matchMedia(media)) : [];
  queries.forEach((query) => query.addEventListener('change', measure));
  view.addEventListener('resize', schedule);
  return () => {
    view.cancelAnimationFrame(frame);
    queries.forEach((query) => query.removeEventListener('change', measure));
    view.removeEventListener('resize', schedule);
  };
}
