// The title bar's drag area for the custom frame (ARCHITECTURE.md sections 10.1 and 10.2). CSS `app-region: drag`
// makes WebView2 treat it as the window caption. Dragging moves the window, and dragging to a screen edge snaps it.
// A double-click toggles maximize, and right-clicking opens the system menu. Windows handles all of it, so this
// needs no script.
//
// `DragRegion` is the flexible gap between the title bar's items, at least 200 DIPs wide at every text size. When
// the bar spreads `titleBarDragProps`, its padding and the gaps between items drag too. The items themselves stay
// page content, because WebView2 hides a drag area's content from UI Automation hit tests, and Narrator's touch
// exploration must still read the breadcrumb and save status. With the flag off, both are ordinary layout.
//
// With the flag on, the drag area is exempt from a modal dialog's inertness (ui/inert.ts), so the window can
// always be moved. The bar's items stay inert under the dialog.

import styles from './DragRegion.module.css';
import { useCustomFrame } from './windowState';

export function DragRegion() {
  const customFrame = useCustomFrame();
  return (
    <div
      className={styles.dragRegion}
      data-app-region={customFrame ? 'drag' : undefined}
      data-modal-exempt={customFrame ? '' : undefined}
      aria-hidden="true"
    />
  );
}

/** Props for the title bar element, so its padding and gaps drag the window while its items stay content. */
export function titleBarDragProps(customFrame: boolean): { 'data-app-region'?: 'drag' } {
  return customFrame ? { 'data-app-region': 'drag' } : {};
}
