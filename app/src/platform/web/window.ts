// The window client in a browser. The browser tab is the window: the title goes to document.title, and the
// frame theme, caption layout, and system menu are recorded for tests.

import type { CaptionLayout, CaptionState, Point, ThemeName, WindowClient } from '../types';
import { emitter } from './emitter';
import { registerTestHook } from './testHooks';

export interface WebWindow extends WindowClient {
  /** What the fake has been asked to do, for tests. */
  readonly calls: { frameTheme: ThemeName[]; captionLayout: (CaptionLayout | null)[]; systemMenu: (Point | null)[] };
}

export function createWebWindow(onClose: () => void): WebWindow {
  let maximized = false;
  const maximizedChanged = emitter<[boolean]>();
  const captionState = emitter<[CaptionState]>();
  const forwarded = emitter<[string[]]>();
  const calls: WebWindow['calls'] = { frameTheme: [], captionLayout: [], systemMenu: [] };
  registerTestHook('windowCalls', () => calls);
  registerTestHook('forwardArgs', (args: string[]) => forwarded.emit(args));
  return {
    calls,
    minimize: () => {},
    toggleMaximize() {
      maximized = !maximized;
      maximizedChanged.emit(maximized);
    },
    close: onClose,
    isMaximized: () => maximized,
    onMaximizedChange: maximizedChanged.on,
    setTitle(title) {
      document.title = title;
    },
    setCaptionLayout: (layout) => void calls.captionLayout.push(layout),
    onCaptionState: captionState.on,
    showSystemMenu: (at) => void calls.systemMenu.push(at),
    setFrameTheme: (theme) => void calls.frameTheme.push(theme),
    onForwardedArgs: forwarded.on,
  };
}
