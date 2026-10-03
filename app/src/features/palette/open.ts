// Opening the palette and the quick switcher. Their code is a lazy chunk, loaded early so the first Ctrl+K opens
// within the 50 ms budget (ARCHITECTURE.md section 20.3). It loads when the window is idle after start-up, and on
// the first key press with Ctrl.

import { lazy } from 'react';
import { focusZone } from '../../commands/registry';
import { closeOverlay, openOverlay, showOverlay } from '../../shell/commandbar/overlays';
import { setOpenerZone } from './commandsProvider';
import type { PaletteMode } from './usePalette';

type PaletteModule = typeof import('./CommandPalette');

let loading: Promise<PaletteModule> | null = null;

export function preloadPalette(): Promise<PaletteModule> {
  loading ??= import('./CommandPalette');
  return loading;
}

const LazyPalette = lazy(preloadPalette);

/** Opens the palette or the quick switcher, or closes it when it is already open. */
export function togglePalette(mode: PaletteMode): void {
  if (openOverlay() === mode) {
    closeOverlay();
    return;
  }
  setOpenerZone(focusZone());
  showOverlay(mode, LazyPalette, { mode });
}

const IDLE_TIMEOUT_MS = 3000;

/** Loads the palette on idle and on the first Ctrl key press. Returns a function that stops waiting. */
export function preloadWhenIdle(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.ctrlKey) return;
    stop();
    void preloadPalette();
  };
  const idle = target.requestIdleCallback
    ? target.requestIdleCallback(() => void preloadPalette(), { timeout: IDLE_TIMEOUT_MS })
    : null;
  const stop = () => {
    target.removeEventListener('keydown', onKeyDown, true);
    if (idle !== null) target.cancelIdleCallback(idle);
  };
  target.addEventListener('keydown', onKeyDown, true);
  return stop;
}
