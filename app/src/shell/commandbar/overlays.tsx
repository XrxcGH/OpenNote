// The overlays that the app commands open: the command palette, the quick switcher, and the keyboard shortcut list.
// App.tsx has no slot for them, so they render in a React root of their own, made on first use. A store says
// which one is open, so resetStores closes it between tests. One overlay shows at a time.

import { Suspense } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { createStore, useStore } from '../../state/store';

export interface OverlayProps {
  /** Closes the overlay. Focus goes back to where it was when the overlay opened. */
  onClose(): void;
}

// Each overlay takes its own props, so the store holds them loosely and showOverlay checks them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOverlay = LazyExoticComponent<ComponentType<any>>;

interface OpenOverlay {
  readonly id: string;
  readonly Component: AnyOverlay;
  readonly props: object;
}

const overlayStore = createStore<{ open: OpenOverlay | null }>({ open: null }, 'overlays');
let root: Root | null = null;

export function closeOverlay(): void {
  if (!overlayStore.get().open) return;
  // Close at once, so focus is back on the opener before whatever the overlay chose to run.
  flushSync(() => overlayStore.set({ open: null }));
}

function Host() {
  const open = useStore(overlayStore, (state) => state.open);
  if (!open) return null;
  const { id, Component, props } = open;
  return (
    <Suspense fallback={null}>
      <Component key={id} {...props} onClose={closeOverlay} />
    </Suspense>
  );
}

/** Shows an overlay in place of any other. `id` names it for openOverlay and toggling. */
export function showOverlay<P extends object>(
  id: string,
  Component: LazyExoticComponent<ComponentType<P & OverlayProps>>,
  props: P,
): void {
  if (!root) {
    const host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    root.render(<Host />);
  }
  overlayStore.set({ open: { id, Component, props } });
}

/** The id of the overlay that is open, or null. */
export function openOverlay(): string | null {
  return overlayStore.get().open?.id ?? null;
}

export function useOpenOverlay(): string | null {
  return useStore(overlayStore, (state) => state.open?.id ?? null);
}
