// Chooses the notes service and makes it available to components (ARCHITECTURE.md section 12.5). Phase 2 uses the
// in-memory service, seeded from the notes snapshot when there is one, else from the sample library. Test builds
// save the snapshot behind notes.memorySnapshot. Phase 3's storage-backed service takes over behind storage.core.
//
// The first loadInitial starts here, before React renders, so the tree and the last page arrive in one call.

import { createContext, createElement, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { isEnabled } from '../../app/flags';
import { getLocation } from '../../app/location';
import type { Platform } from '../../platform/types';
import { createMemoryNotesService } from './memory';
import { parseSnapshot } from './snapshot';
import type { SnapshotData } from './snapshot';
import type { InitialTree, NodeId, NotesService } from './types';

export type * from './types';
export { CHIP_COLORS, NOTES_LIMITS } from './types';
export { NotesError, isNotesError } from './errors';
export type { InvalidNameReason, NotesErrorCode } from './errors';

async function seedFrom(platform: Platform): Promise<SnapshotData | 'sample'> {
  const json = await platform.notesSnapshot?.load().catch(() => null);
  return (json && parseSnapshot(json)) || 'sample';
}

const initialLoads = new WeakMap<NotesService, Promise<InitialTree>>();
let current: NotesService | null = null;

/** The ids along a location, as loadInitial takes them. */
export function pathOf(location: ReturnType<typeof getLocation>): NodeId[] {
  if (location.view !== 'workspace') return [];
  return [location.notebookId, location.sectionId, location.pageId].filter((id): id is NodeId => id !== null);
}

/**
 * The first loadInitial for a service, which createNotesService starts before React renders, so the tree and the
 * last page arrive in one call. The tree takes it once. Anything the service changed meanwhile, such as the
 * notebook that first-run setup makes, drops it, and the tree then asks the service again.
 */
export function initialTree(
  notes: NotesService,
  path: readonly NodeId[] = pathOf(getLocation()),
): Promise<InitialTree> {
  const early = initialLoads.get(notes);
  if (!early) return notes.loadInitial(path);
  initialLoads.delete(notes);
  return early;
}

export async function createNotesService(platform: Platform): Promise<NotesService> {
  const snapshot = isEnabled('notes.memorySnapshot') ? (platform.notesSnapshot ?? undefined) : undefined;
  const service = createMemoryNotesService({ seed: await seedFrom(platform), snapshot });
  const early = service.loadInitial(pathOf(getLocation()));
  initialLoads.set(service, early);
  early.catch(() => initialLoads.delete(service));
  const stop = service.watch(() => {
    initialLoads.delete(service);
    stop();
  });
  current = service;
  return service;
}

/** The service the app runs on, for code outside React such as the exit hooks. */
export function currentNotesService(): NotesService | null {
  return current;
}

const NotesContext = createContext<NotesService | null>(null);

export function NotesProvider(props: { service: NotesService; children: ReactNode }) {
  const { service } = props;
  useEffect(() => {
    current = service;
  }, [service]);
  return createElement(NotesContext.Provider, { value: service }, props.children);
}

export function useNotes(): NotesService {
  const service = useContext(NotesContext);
  if (!service) throw new Error('useNotes needs a NotesProvider.');
  return service;
}
