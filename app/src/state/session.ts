// The session slice: where the person is, history, pane preferences, expanded rows, and recent commands and pages.
// It starts from the device state in the boot payload and is saved through platform.state.update, which Rust
// debounces (ARCHITECTURE.md sections 5.2 and 16.4).

import type { Location } from '../app/location';
import type { CommandId } from '../commands/types';
import type { BootData, DeviceStatePatch, PanePref, Platform, StoredLocation } from '../platform/types';
import type { NodeId } from '../services/notes/types';
import { tokens } from '../theme/tokens';
import { createStore } from './store';

export interface SessionState {
  location: Location;
  back: Location[];
  forward: Location[];
  panes: { notebooks: PanePref; pages: PanePref };
  expanded: readonly string[];
  lastPageBySection: Readonly<Record<string, string>>;
  recentCommands: readonly CommandId[];
  /** Newest first, for the quick switcher (Ctrl+O). */
  recentPages: readonly NodeId[];
}

const RECENT_LIMIT = 20;

export const DEFAULT_LOCATION: Location = { view: 'workspace', notebookId: null, sectionId: null, pageId: null };

export const sessionStore = createStore<SessionState>(
  {
    location: DEFAULT_LOCATION,
    back: [],
    forward: [],
    panes: {
      notebooks: { width: tokens.size.sidebar, collapsed: false },
      pages: { width: tokens.size.pageList, collapsed: false },
    },
    expanded: [],
    lastPageBySection: {},
    recentCommands: [],
    recentPages: [],
  },
  'session',
);

let unsubscribe: (() => void) | null = null;

export function setExpanded(ids: readonly string[]): void {
  sessionStore.set((state) => ({ ...state, expanded: [...ids] }));
}

export function setPanePref(pane: 'notebooks' | 'pages', pref: Partial<PanePref>): void {
  sessionStore.set((state) => ({ ...state, panes: { ...state.panes, [pane]: { ...state.panes[pane], ...pref } } }));
}

const recent = <T>(list: readonly T[], item: T) =>
  [item, ...list.filter((other) => other !== item)].slice(0, RECENT_LIMIT);

export function recordRecentCommand(id: CommandId): void {
  sessionStore.set((state) => ({ ...state, recentCommands: recent(state.recentCommands, id) }));
}

export function recordRecentPage(id: NodeId): void {
  sessionStore.set((state) => ({ ...state, recentPages: recent(state.recentPages, id) }));
}

export function fromStored(stored: StoredLocation): Location {
  return stored as Location;
}

function toStored(location: Location): StoredLocation {
  return location as StoredLocation;
}

/** The device state fields that changed, as a patch. */
function patchFor(next: SessionState, previous: SessionState): DeviceStatePatch {
  const patch: DeviceStatePatch = {};
  if (next.location !== previous.location) patch.location = toStored(next.location);
  if (next.panes !== previous.panes) patch.panes = next.panes;
  if (next.expanded !== previous.expanded) patch.expanded = [...next.expanded];
  if (next.lastPageBySection !== previous.lastPageBySection) patch.lastPageBySection = { ...next.lastPageBySection };
  if (next.recentCommands !== previous.recentCommands) patch.recentCommands = [...next.recentCommands];
  if (next.recentPages !== previous.recentPages) patch.recentPages = [...next.recentPages];
  return patch;
}

export function initSession(boot: BootData, platform: Platform): void {
  unsubscribe?.();
  const { state } = boot;
  sessionStore.set((current) => ({
    ...current,
    location: fromStored(state.location),
    back: [],
    forward: [],
    panes: state.panes,
    expanded: state.expanded,
    lastPageBySection: state.lastPageBySection as Record<string, string>,
    recentCommands: state.recentCommands as CommandId[],
    recentPages: state.recentPages as NodeId[],
  }));
  let previous = sessionStore.get();
  unsubscribe = sessionStore.subscribe(() => {
    const next = sessionStore.get();
    const patch = patchFor(next, previous);
    previous = next;
    if (Object.keys(patch).length > 0) platform.state.update(patch);
  });
}
