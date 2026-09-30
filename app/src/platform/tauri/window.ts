// The window: caption actions, the title, the caption layout for Snap Layouts, the system menu, and the DWM
// frame theme. Tauri's setTheme is never called, because it would pin WebView2's color scheme.

import type { WindowClient } from '../types';
import { fire, listen } from './invoke';

export function createTauriWindow(initiallyMaximized: boolean): WindowClient {
  let maximized = initiallyMaximized;
  listen('window://maximized', (value) => (maximized = value));
  return {
    minimize: () => fire('window_minimize'),
    toggleMaximize: () => fire('window_toggle_maximize'),
    close: () => fire('window_close'),
    isMaximized: () => maximized,
    onMaximizedChange: (listener) => listen('window://maximized', listener),
    setTitle: (title) => fire('window_set_title', { title }),
    setCaptionLayout: (layout) => fire('window_set_caption_layout', { layout }),
    onCaptionState: (listener) => listen('window://caption-state', listener),
    showSystemMenu: (at) => fire('window_show_system_menu', { at }),
    setFrameTheme: (theme) => fire('window_set_frame_theme', { theme }),
    onForwardedArgs: (listener) => listen('window://forwarded-args', listener),
  };
}
