// The window state the custom frame draws: maximized or restored, active or inactive, and the Snap Layouts
// overlay's hover and pressed state (ARCHITECTURE.md sections 10.3 and 10.5).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFlag } from '../../app/flags';
import { commandContext } from '../../commands/registry';
import type { CaptionState, WindowClient } from '../../platform/types';

/** The window client from the platform the commands were given at start-up, or null before start-up. */
export function frameWindow(): WindowClient | null {
  try {
    return commandContext('titleBar').platform.window;
  } catch {
    return null;
  }
}

/** Whether the page draws the title bar and caption buttons (the `shell.customFrame` flag). */
export function useCustomFrame(): boolean {
  return useFlag('shell.customFrame');
}

/** Whether the native Snap Layouts overlay covers Maximize: the custom frame with `window.snapLayouts` on. */
export function useSnapLayoutsOverlay(): boolean {
  const snapLayouts = useFlag('window.snapLayouts');
  return useCustomFrame() && snapLayouts;
}

/**
 * Whether the window is maximized, from each `window://maximized` payload. It doesn't reread `isMaximized()` on
 * a change, because Tauri may call this listener before the one that updates the client's own copy.
 */
export function useMaximized(client: WindowClient | null): boolean {
  const last = useRef<boolean | null>(null);
  const subscribe = useCallback(
    (onChange: () => void) => {
      last.current = null;
      if (!client) return () => {};
      return client.onMaximizedChange((maximized) => {
        last.current = maximized;
        onChange();
      });
    },
    [client],
  );
  return useSyncExternalStore(subscribe, () => last.current ?? client?.isMaximized() ?? false);
}

function subscribeToFocus(onChange: () => void): () => void {
  window.addEventListener('focus', onChange);
  window.addEventListener('blur', onChange);
  return () => {
    window.removeEventListener('focus', onChange);
    window.removeEventListener('blur', onChange);
  };
}

/** Whether the window is the active one, so an inactive window can dim its caption glyphs as Windows does. */
export function useWindowActive(): boolean {
  return useSyncExternalStore(subscribeToFocus, () => document.hasFocus());
}

const RESTING: CaptionState = { hovered: false, pressed: false };

/** The overlay's hover and pressed state while `enabled`, sent by Rust as `window://caption-state`. */
export function useCaptionState(client: WindowClient | null, enabled: boolean): CaptionState {
  const [state, setState] = useState(RESTING);
  useEffect(() => {
    if (!client || !enabled) return undefined;
    const stop = client.onCaptionState(setState);
    return () => {
      stop();
      setState(RESTING);
    };
  }, [client, enabled]);
  return enabled ? state : RESTING;
}
