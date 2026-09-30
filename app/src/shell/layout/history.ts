// History input and the window title (ARCHITECTURE.md section 5.3). The mouse's back and forward buttons run the
// same commands as Alt+Left and Alt+Right. The native window title and document.title follow the location, so
// Alt+Tab, the taskbar, and NVDA+T say where the person is: "Cell structure - OpenNote", "Settings - OpenNote",
// "Trash - OpenNote", and "Set up OpenNote".

import { useEffect } from 'react';
import { useLocation } from '../../app/location';
import type { Location } from '../../app/location';
import { executeCommand } from '../../commands/registry';
import type { NodeSummary } from '../../services/notes/types';
import { t } from '../../strings/t';
import { hostWindow } from '../titlebar/hostWindow';
import { useNodes } from './useNode';

/** The mouse's back (X1) and forward (X2) buttons, as MouseEvent.button reports them. */
const BUTTONS: Record<number, 'nav.back' | 'nav.forward'> = { 3: 'nav.back', 4: 'nav.forward' };

/** Runs back and forward from the mouse's side buttons, and stops WebView2 from navigating the page itself. */
export function useHistoryMouseButtons(): void {
  useEffect(() => {
    const onButton = (event: MouseEvent) => {
      if (!(event.button in BUTTONS)) return;
      event.preventDefault();
      if (event.type === 'mouseup') void executeCommand(BUTTONS[event.button], undefined, 'titleBar');
    };
    for (const type of ['mousedown', 'mouseup', 'auxclick'] as const) window.addEventListener(type, onButton, true);
    return () => {
      for (const type of ['mousedown', 'mouseup', 'auxclick'] as const)
        window.removeEventListener(type, onButton, true);
    };
  }, []);
}

/** The longest title Rust accepts is 200 characters, so a long page title is cut to fit. */
const MAX_TITLE = 200;

export function windowTitleFor(location: Location, nodes: readonly (NodeSummary | null)[]): string {
  if (location.view === 'settings') return t('titleBar.windowTitle.settings');
  if (location.view === 'trash') return t('titleBar.windowTitle.trash');
  if (location.view === 'setup') return t('titleBar.windowTitle.setup');
  const deepest = [...nodes].reverse().find((node) => node !== null);
  if (!deepest) return t('titleBar.windowTitle.app');
  const room = MAX_TITLE - t('titleBar.windowTitle.page', { title: '' }).length;
  const title = deepest.title.length > room ? `${deepest.title.slice(0, room - 1)}…` : deepest.title;
  return t('titleBar.windowTitle.page', { title });
}

export function useWindowTitle(): void {
  const location = useLocation();
  const ids = location.view === 'workspace' ? [location.notebookId, location.sectionId, location.pageId] : [];
  const nodes = useNodes(ids);
  const title = windowTitleFor(location, nodes);
  useEffect(() => {
    document.title = title;
    hostWindow()?.setTitle(title);
  }, [title]);
}
