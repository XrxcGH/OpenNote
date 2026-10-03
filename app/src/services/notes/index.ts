// Chooses the notes service and makes it available to components (ARCHITECTURE.md section 12.5). A real profile
// uses the service over the core (core/service.ts), which keeps the notes in the notes folder: a folder for each
// notebook, with its sections, pages, and Trash. The web platform, which the dev server and the tests run on, uses
// the in-memory service with the sample library, and saves it to the Phase 2 snapshot behind its flag. A real
// profile without storage.core falls back to the in-memory service, which keeps nothing unless the snapshot flag
// is on and says so (the service is volatile).
//
// The first loadInitial starts here, before React renders, so the tree and the last page arrive in one call.

import { createContext, createElement, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { isEnabled } from '../../app/flags';
import { getLocation } from '../../app/location';
import type { Platform } from '../../platform/types';
import { createCoreNotesService } from './core/service';
import { createMemoryNotesService } from './memory';
import { parseSnapshot } from './snapshot';
import type { SnapshotData } from './snapshot';
import type { InitialTree, NodeId, NotesService } from './types';

export type * from './types';
export { CHIP_COLORS, NOTES_LIMITS } from './types';
export { NotesError, isNotesError } from './errors';
export { NOT_KEPT } from './snapshot';
export type { InvalidNameReason, NotesErrorCode } from './errors';

/**
 * Only the development shell shows the sample library: the web platform, which the dev server and every test run
 * on, and the dev channel. Any other profile is a person's own, where the notebook that first-run setup makes
 * must be the whole library, and samples would be saved along with it.
 */
function showsSamples(platform: Platform): boolean {
  return platform.kind === 'web' || platform.boot.channel === 'dev';
}

async function seedFrom(platform: Platform): Promise<SnapshotData | 'sample'> {
  const json = await platform.notesSnapshot?.load().catch(() => null);
  const saved = json ? parseSnapshot(json) : null;
  if (saved) return saved;
  if (showsSamples(platform)) return 'sample';
  const { boot } = platform;
  return { folder: boot.settings.storage.notesFolder ?? boot.install.proposedNotesFolder ?? '', notebooks: [] };
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

async function memoryService(platform: Platform): Promise<NotesService> {
  const keeps = isEnabled('storage.core') || isEnabled('notes.memorySnapshot');
  const snapshot = keeps ? (platform.notesSnapshot ?? undefined) : undefined;
  // A real profile without the snapshot has nothing that keeps the notes, so the service must not say they're saved.
  const volatile = !snapshot && platform.kind === 'tauri';
  return createMemoryNotesService({ seed: await seedFrom(platform), snapshot, volatile });
}

export async function createNotesService(platform: Platform): Promise<NotesService> {
  const service = platform.notesCore ? createCoreNotesService(platform.notesCore) : await memoryService(platform);
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
