// How the layout answers a deliberate choice (ARCHITECTURE.md section 11.4). Choosing a section closes the medium
// drawer and moves focus to the pages pane, opens the expanded pages overlay, or shows the compact pages screen.
// Choosing a page closes the overlay and moves focus into the page, or shows the compact page screen. Selection
// that follows arrow keys replaces the location instead of pushing it, so it never moves the layout.
// Going back or forward in the compact layout shows the screen that fits where history lands.

import { useEffect } from 'react';
import { onNavigate } from '../../app/location';
import type { Location, Navigation } from '../../app/location';
import { layoutStore, updateLayout } from '../../state/layout';
import type { CompactScreen } from '../../state/layout';
import { regionOf } from '../regions';
import { closeDrawerForChoice } from './Drawer';
import { closeOverlayForChoice } from './PagesOverlay';
import { setCompactScreen, setOverlayOpen } from './paneActions';

type Workspace = Extract<Location, { view: 'workspace' }>;

/** The compact screen that shows a location: the page if one is open, else the section's pages. */
export function compactScreenFor(location: Location): CompactScreen {
  if (location.view !== 'workspace') return 'page';
  if (location.pageId) return 'page';
  return location.sectionId ? 'pages' : 'notebooks';
}

/** What the person chose, judged from where focus was: a row in the notebooks or the pages pane, or elsewhere. */
export function choiceOf(navigation: Navigation, origin = regionOf(document.activeElement)): 'section' | 'page' | null {
  if (navigation.kind !== 'push' || navigation.to.view !== 'workspace') return null;
  const to: Workspace = navigation.to;
  const from = navigation.from.view === 'workspace' ? navigation.from : null;
  const section = to.sectionId !== null && to.sectionId !== from?.sectionId;
  const page = to.pageId !== null && to.pageId !== from?.pageId;
  if (origin === 'notebooks') return section ? 'section' : null;
  if (origin === 'pages') return page ? 'page' : null;
  return page ? 'page' : section ? 'section' : null;
}

function follow(navigation: Navigation): void {
  const { sizeClass, drawerOpen, overlayOpen } = layoutStore.get();
  if (sizeClass === 'compact' && (navigation.kind === 'back' || navigation.kind === 'forward')) {
    updateLayout({ compactScreen: compactScreenFor(navigation.to) });
    return;
  }
  const choice = choiceOf(navigation);
  if (!choice) return;
  if (sizeClass === 'medium' && drawerOpen && choice === 'section') closeDrawerForChoice();
  if (sizeClass === 'expanded' && choice === 'section') setOverlayOpen(true);
  if (sizeClass === 'expanded' && overlayOpen && choice === 'page') closeOverlayForChoice();
  if (sizeClass === 'compact') void setCompactScreen(choice === 'section' ? 'pages' : 'page');
}

export function useLayoutFollowsNavigation(): void {
  useEffect(() => onNavigate(follow), []);
}
