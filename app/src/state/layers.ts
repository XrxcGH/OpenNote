// One layer stack for every overlay (ARCHITECTURE.md section 15.2): menus, popovers, the palette, dialogs, the
// drawer, the pages overlay, and inline rename. Escape closes only the top layer, and Settings asks the stack
// whether Escape may leave it.

import { createStore, useStore } from './store';

export type LayerKind = 'menu' | 'submenu' | 'popover' | 'palette' | 'dialog' | 'drawer' | 'overlay' | 'rename';

export interface Layer {
  id: string;
  kind: LayerKind;
  modal: boolean;
  close(reason: 'escape' | 'programmatic'): void;
  returnFocus?: () => HTMLElement | null;
}

export const layerStore = createStore<readonly Layer[]>([], 'layers');

/** Adds a layer on top. Returns a function that removes it again. */
export function pushLayer(layer: Layer): () => void {
  layerStore.set((layers) => [...layers.filter((other) => other.id !== layer.id), layer]);
  return () => layerStore.set((layers) => layers.filter((other) => other !== layer));
}

export function topLayer(): Layer | undefined {
  const layers = layerStore.get();
  return layers[layers.length - 1];
}

export function hasOpenLayer(): boolean {
  return layerStore.get().length > 0;
}

/** True while a modal layer, such as a dialog or the drawer, is open anywhere in the stack. */
export function hasModalLayer(): boolean {
  return layerStore.get().some((layer) => layer.modal);
}

export function useHasModalLayer(): boolean {
  return useStore(layerStore, (layers) => layers.some((layer) => layer.modal));
}

/** Closes every open layer, top first, for example when the window loses focus. */
export function closeAllLayers(reason: 'escape' | 'programmatic' = 'programmatic'): void {
  [...layerStore.get()].reverse().forEach((layer) => layer.close(reason));
}

const interceptors = new Set<() => boolean>();

/**
 * Lets something that isn't a layer take Escape first, such as a showing tooltip (WCAG 1.4.13): when the
 * interceptor returns true, it used the key, and no layer closes. Returns a function that removes it.
 */
export function interceptEscape(interceptor: () => boolean): () => void {
  interceptors.add(interceptor);
  return () => void interceptors.delete(interceptor);
}

/** Escape closes the top layer and nothing under it. Returns a function that stops listening. */
export function installLayerEscape(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    const used = [...interceptors].some((interceptor) => interceptor());
    const top = used ? undefined : topLayer();
    if (!used && !top) return;
    event.preventDefault();
    event.stopPropagation();
    top?.close('escape');
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
