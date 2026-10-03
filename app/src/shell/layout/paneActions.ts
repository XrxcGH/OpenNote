// Pane actions (ARCHITECTURE.md sections 11.3 to 11.5): show, hide, and resize the notebooks and pages panes in
// the way each size class allows. The pane commands, the splitters, and the rail buttons all call these, so every
// resize is available without dragging (WCAG 2.5.7).

import { layoutStore, updateLayout } from '../../state/layout';
import type { CompactScreen } from '../../state/layout';
import { sessionStore, setPanePref } from '../../state/session';
import { focusRegion, focusRegionSoon, regionOf, repairFocus } from '../regions';
import { finishSlides, slide } from './motion';
import { clampPaneWidth, PANE_LIMITS, paneBounds } from './solvePanes';
import type { PaneId, PanePrefs } from './solvePanes';

/** The resize step for Wider and Narrower, and for Shift+Arrow on a splitter. */
export const RESIZE_STEP = 40;

export function panePrefs(): PanePrefs {
  return sessionStore.get().panes;
}

/** Whether the pane's content is on screen now, in the current size class. */
export function isPaneShowing(pane: PaneId): boolean {
  const { sizeClass, drawerOpen, overlayOpen, mediumPagesCollapsed, compactScreen } = layoutStore.get();
  const prefs = panePrefs();
  if (sizeClass === 'compact') return compactScreen === pane;
  if (pane === 'notebooks') return sizeClass === 'medium' ? drawerOpen : !prefs.notebooks.collapsed;
  if (sizeClass === 'medium') return !mediumPagesCollapsed;
  if (sizeClass === 'expanded') return overlayOpen;
  return !prefs.pages.collapsed;
}

/** Whether the pane is a resizable column now. */
export function isPaneResizable(pane: PaneId): boolean {
  const { sizeClass } = layoutStore.get();
  if (sizeClass === 'wide') return true;
  return sizeClass === 'expanded' && (pane === 'pages' || !panePrefs().notebooks.collapsed);
}

const content = (pane: PaneId) => document.querySelector<HTMLElement>(`[data-pane-content="${pane}"]`);

/** Runs after React has drawn the change. */
const afterRender = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

/** Collapses a wide or expanded pane to its rail, sliding its content out first. */
async function collapse(pane: PaneId): Promise<void> {
  const element = content(pane);
  // Focus on the splitter stays there; focus inside the content moves to the rail.
  const hadFocus = element?.contains(document.activeElement) ?? false;
  await slide(element, 'out');
  setPanePref(pane, { collapsed: true });
  await afterRender();
  // The rail's expand button is now the first control in the region.
  if (hadFocus) focusRegion(pane, 'main');
  repairFocus(pane);
}

/** Expands a wide or expanded pane from its rail and moves focus into it. */
async function expand(pane: PaneId, moveFocus: boolean): Promise<void> {
  setPanePref(pane, { collapsed: false });
  await afterRender();
  if (moveFocus) focusRegionSoon(pane, 'main');
  await slide(content(pane), 'in');
}

/** Opens or closes a column pane, or the drawer, overlay, or screen that stands in for it in this size class. */
export async function setPaneShowing(pane: PaneId, show: boolean, moveFocus = true): Promise<void> {
  finishSlides();
  if (isPaneShowing(pane) === show) {
    if (show && moveFocus) focusRegion(pane, 'main');
    return;
  }
  const { sizeClass } = layoutStore.get();
  if (sizeClass === 'compact') return setCompactScreen(show ? pane : 'page');
  if (sizeClass === 'medium' && pane === 'notebooks') return setDrawerOpen(show);
  if (sizeClass === 'expanded' && pane === 'pages') return setOverlayOpen(show);
  if (sizeClass === 'medium') return setMediumPages(show, moveFocus);
  return show ? expand(pane, moveFocus) : collapse(pane);
}

export function togglePane(pane: PaneId, moveFocus = true): Promise<void> {
  return setPaneShowing(pane, !isPaneShowing(pane), moveFocus);
}

async function setMediumPages(show: boolean, moveFocus: boolean): Promise<void> {
  const hadFocus = regionOf(document.activeElement) === 'pages';
  updateLayout({ mediumPagesCollapsed: !show });
  await afterRender();
  if (show && moveFocus) focusRegionSoon('pages', 'main');
  // Hiding the medium pages pane moves focus to the page (ARCHITECTURE.md section 11.4).
  else if (!show && hadFocus) focusRegion('page', 'main');
  repairFocus('page');
}

/** Sets a pane's stored width, clamped to what the window allows now. */
export function setPaneWidth(pane: PaneId, width: number): void {
  const { width: windowWidth, sizeClass } = layoutStore.get();
  const bounds = paneBounds(pane, windowWidth, sizeClass, panePrefs());
  setPanePref(pane, { width: Math.round(Math.min(bounds.max, Math.max(bounds.min, width))) });
}

/** The width the pane shows now, or would show if it were expanded. */
export function paneWidth(pane: PaneId): number {
  const { width: windowWidth, sizeClass } = layoutStore.get();
  const prefs = panePrefs();
  const bounds = paneBounds(pane, windowWidth, sizeClass, prefs);
  return Math.min(bounds.max, clampPaneWidth(pane, prefs[pane].width));
}

export function resizePane(pane: PaneId, delta: number): void {
  setPaneWidth(pane, paneWidth(pane) + delta);
}

export function resetPane(pane: PaneId): void {
  setPanePref(pane, { width: PANE_LIMITS[pane].default });
}

/** Opens or closes the medium notebooks drawer. The drawer moves focus in and back itself. */
export function setDrawerOpen(open: boolean): void {
  updateLayout({ drawerOpen: open });
}

/** Opens or closes the expanded pages overlay. The overlay moves focus in and back itself. */
export function setOverlayOpen(open: boolean): void {
  updateLayout({ overlayOpen: open });
}

/** Shows one screen of the compact stack and moves focus into it. */
export async function setCompactScreen(screen: CompactScreen): Promise<void> {
  if (layoutStore.get().compactScreen === screen) return;
  updateLayout({ compactScreen: screen });
  await afterRender();
  focusRegionSoon(screen, 'main');
}

const UP: Record<CompactScreen, CompactScreen | null> = { page: 'pages', pages: 'notebooks', notebooks: null };

/** The compact screen one level up, or null at the top. */
export function compactParent(): CompactScreen | null {
  const { sizeClass, compactScreen } = layoutStore.get();
  return sizeClass === 'compact' ? UP[compactScreen] : null;
}
