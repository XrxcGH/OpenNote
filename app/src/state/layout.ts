// The layout slice: size class and density (ARCHITECTURE.md sections 9.8 and 11.1). WP0 derives the size class
// from the window width and the density from the primary pointer. WP5 adds the pane solver, and WP3's density
// controller calls setDensity. Both write root attributes, so CSS selects on them.

import { tokens } from '../theme/tokens';
import { createStore, useStore } from './store';

export type SizeClass = 'compact' | 'medium' | 'expanded' | 'wide';
export type Density = 'mouse' | 'touch';

interface LayoutState {
  sizeClass: SizeClass;
  density: Density;
}

export const layoutStore = createStore<LayoutState>({ sizeClass: 'wide', density: 'mouse' }, 'layout');

/** The size class for a width in CSS pixels. Each breakpoint is the lower edge of its class. */
export function sizeClassFor(width: number): SizeClass {
  const { medium, expanded, wide } = tokens.breakpoint;
  if (width >= wide) return 'wide';
  if (width >= expanded) return 'expanded';
  if (width >= medium) return 'medium';
  return 'compact';
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

export function setSizeClass(sizeClass: SizeClass): void {
  layoutStore.set((state) => (state.sizeClass === sizeClass ? state : { ...state, sizeClass }));
  document.documentElement.dataset.sizeClass = sizeClass;
}

/** Follows the window width, and starts density from the primary pointer. Returns a function that stops it. */
export function initLayout(view: Window = window): () => void {
  const update = () => setSizeClass(sizeClassFor(view.innerWidth));
  update();
  setDensity(view.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'mouse');
  view.addEventListener('resize', update);
  return () => view.removeEventListener('resize', update);
}
