// Tabs and recently closed (docs/FEATURES.md, "Tabs and windows" and "Recently closed"). A tab is a place in the
// workspace. The active tab follows the location, as a browser tab follows its address, so following a link in a
// tab changes that tab. Closing a tab keeps its place on the recently closed list, and Ctrl+Shift+T reopens it.
// Tabs are not saved: a new start begins with one place, as before.

import { getLocation, navigate, onNavigate } from '../../app/location';
import type { Location } from '../../app/location';
import { shellCall } from '../../platform/shellqol';
import type { NodeId, NotesService } from '../../services/notes';
import { CLOSED_LIMIT, qolStore } from '../../state/qol';
import type { ClosedTab, Tab } from '../../state/qol';
import { t } from '../../strings/t';
import { announce } from '../../ui';
import { getNode } from '../tree';

type Workspace = Extract<Location, { view: 'workspace' }>;

let counter = 0;
const newTabId = () => `tab-${(counter += 1)}`;

const sameWorkspace = (a: Workspace, b: Workspace) =>
  a.notebookId === b.notebookId && a.sectionId === b.sectionId && a.pageId === b.pageId;

function workspaceNow(): Workspace | null {
  const location = getLocation();
  return location.view === 'workspace' ? location : null;
}

/** The title a tab shows: the page, else the section, else the notebook. */
export function tabTitle(location: Workspace): string {
  const node = getNode(location.pageId) ?? getNode(location.sectionId) ?? getNode(location.notebookId);
  return node?.title.trim() || t('qol.tabs.untitled');
}

/** Opens a place in a new tab right after the active one, and goes there. */
export function openInNewTab(target: Workspace): void {
  const state = qolStore.get();
  const here = workspaceNow();
  let tabs: readonly Tab[] = state.tabs;
  let active = state.activeTab;
  if (tabs.length === 0 && here) {
    const first: Tab = { id: newTabId(), location: here };
    tabs = [first];
    active = first.id;
  }
  const tab: Tab = { id: newTabId(), location: target };
  const at = tabs.findIndex((one) => one.id === active);
  tabs = [...tabs.slice(0, at + 1), tab, ...tabs.slice(at + 1)];
  qolStore.set({ ...state, tabs, activeTab: tab.id });
  navigate(target);
  announce(t('qol.tabs.opened', { title: tabTitle(target) }));
}

/** Opens the open page (else the open place) in a new tab. */
export function duplicateTab(): void {
  const here = workspaceNow();
  if (here) openInNewTab(here);
}

export function activateTab(id: string): void {
  const state = qolStore.get();
  const tab = state.tabs.find((one) => one.id === id);
  if (!tab) return;
  qolStore.set({ ...state, activeTab: id });
  navigate(tab.location);
}

/** Moves to the next tab (1) or the previous one (-1), wrapping around. */
export function stepTab(step: 1 | -1): void {
  const { tabs, activeTab } = qolStore.get();
  if (tabs.length < 2) return;
  const at = tabs.findIndex((tab) => tab.id === activeTab);
  activateTab(tabs[(at + step + tabs.length) % tabs.length].id);
}

export function closeTab(id: string): void {
  const state = qolStore.get();
  const at = state.tabs.findIndex((tab) => tab.id === id);
  if (at === -1 || state.tabs.length < 2) return;
  const tab = state.tabs[at];
  const closed: ClosedTab = { location: tab.location, title: tabTitle(tab.location), closedAt: Date.now() };
  const tabs = state.tabs.filter((one) => one.id !== id);
  const activeGone = state.activeTab === id;
  const next = activeGone ? tabs[Math.min(at, tabs.length - 1)] : null;
  qolStore.set({
    ...state,
    tabs,
    activeTab: next ? next.id : state.activeTab,
    closedTabs: [closed, ...state.closedTabs].slice(0, CLOSED_LIMIT),
  });
  if (next) navigate(next.location);
  announce(t('qol.tabs.closed', { title: closed.title }));
}

export function closeActiveTab(): void {
  const { activeTab } = qolStore.get();
  if (activeTab) closeTab(activeTab);
}

/** Takes one place off the recently closed list, if it is still there. */
function takeClosed(closed: ClosedTab): void {
  qolStore.set((state) => ({ ...state, closedTabs: state.closedTabs.filter((one) => one !== closed) }));
}

/** Whether the page (or section) a closed tab showed is still in the notes. */
async function stillThere(notes: NotesService, location: Workspace): Promise<boolean> {
  const id = (location.pageId ?? location.sectionId ?? location.notebookId) as NodeId | null;
  return id === null ? false : (await notes.get(id)) !== null;
}

/** Reopens a closed tab, or the newest one. Pages that are gone are skipped. Resolves true when one opened. */
export async function reopenClosed(notes: NotesService, which?: ClosedTab): Promise<boolean> {
  const candidates = which ? [which] : [...qolStore.get().closedTabs];
  for (const closed of candidates) {
    takeClosed(closed);
    if (await stillThere(notes, closed.location)) {
      openInNewTab(closed.location);
      return true;
    }
  }
  announce(t('qol.tabs.nothingToReopen'));
  return false;
}

/** Opens a page in a window of its own, beside the main window. */
export async function openInWindow(location: Workspace): Promise<void> {
  if (!location.pageId) return;
  await shellCall('window.openPage', {
    pageId: location.pageId,
    sectionId: location.sectionId,
    notebookId: location.notebookId,
    title: tabTitle(location),
  });
}

/** Makes the active tab follow the location. Returns a function that stops. */
export function trackTabs(): () => void {
  return onNavigate(({ to }) => {
    if (to.view !== 'workspace') return;
    qolStore.set((state) => {
      const at = state.tabs.findIndex((tab) => tab.id === state.activeTab);
      if (at === -1 || sameWorkspace(state.tabs[at].location, to)) return state;
      const tabs = state.tabs.map((tab, index) => (index === at ? { ...tab, location: to } : tab));
      return { ...state, tabs };
    });
  });
}
