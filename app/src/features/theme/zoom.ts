// Text size (ARCHITECTURE.md sections 9.7 and 10.4): Ctrl+= and Ctrl+- step through the sizes and Ctrl+0 resets.
// Ctrl+wheel does the same outside the page, which zooms itself instead (Phase 4 amendment P2-13). The setting
// goes to Rust, which applies the effective zoom to the WebView and reports it back as --zoom.

import type { TextSize } from '../../platform/types';
import { getSettings, updateSettings } from '../../state/settings';
import { t } from '../../strings/t';
import { announce } from '../../ui';

export const TEXT_SIZES: readonly TextSize[] = [80, 90, 100, 110, 125, 150, 175, 200];
const DEFAULT_TEXT_SIZE: TextSize = 100;
/** One notch of a mouse wheel. Touchpad pinches send many smaller steps, which add up to one. */
const WHEEL_STEP = 100;

/** The next size in the list, in either direction, stopping at the ends. */
export function steppedTextSize(current: TextSize, direction: 1 | -1): TextSize {
  const index = TEXT_SIZES.indexOf(current);
  const from = index === -1 ? TEXT_SIZES.indexOf(DEFAULT_TEXT_SIZE) : index;
  return TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, from + direction))];
}

/** Saves a text size and says it, unless it is already the size. */
export function setTextSize(size: TextSize): void {
  if (getSettings().appearance.textSize === size) return;
  void updateSettings({ appearance: { textSize: size } }).catch(() => {});
  announce(t('theme.announce.textSize', { size }));
}

export function stepTextSize(direction: 1 | -1): void {
  setTextSize(steppedTextSize(getSettings().appearance.textSize, direction));
}

export function resetTextSize(): void {
  setTextSize(DEFAULT_TEXT_SIZE);
}

/** Ctrl+wheel steps the text size anywhere but the page. Returns a function that stops listening. */
export function installZoomWheel(view: Window = window): () => void {
  let travel = 0;
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    if (event.target instanceof Element && event.target.closest('[data-region="page"]')) return;
    // Stops the WebView's own zoom, which would scale the page region too.
    event.preventDefault();
    travel += event.deltaY;
    if (Math.abs(travel) < WHEEL_STEP) return;
    stepTextSize(travel < 0 ? 1 : -1);
    travel = 0;
  };
  view.addEventListener('wheel', onWheel, { passive: false });
  return () => view.removeEventListener('wheel', onWheel);
}
