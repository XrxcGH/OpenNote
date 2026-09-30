// One layer stack for every overlay (ARCHITECTURE.md section 15.2): menus, popovers, the palette, dialogs, the
// drawer, the pages overlay, and inline rename. Escape closes only the top layer, and Settings asks the stack
// whether Escape may leave it.

import { createStore } from './store';

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

/** Escape closes the top layer and nothing under it. Returns a function that stops listening. */
export function installLayerEscape(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const top = topLayer();
    if (!top) return;
    event.preventDefault();
    event.stopPropagation();
    top.close('escape');
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
