// Chooses the notes service and makes it available to components (ARCHITECTURE.md section 12.5). Phase 2 uses the
// in-memory service, seeded from the notes snapshot when there is one. Without one, the web platform and the dev
// channel start from the sample library, and a real profile starts empty. Test builds save the snapshot behind
// notes.memorySnapshot; a real profile without it keeps nothing and says so (the service is volatile). Phase 3's
// storage-backed service takes over behind storage.core.
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

export async function createNotesService(platform: Platform): Promise<NotesService> {
  const snapshot = isEnabled('notes.memorySnapshot') ? (platform.notesSnapshot ?? undefined) : undefined;
  // A real profile without the snapshot has nothing that keeps the notes, so the service must not say they're saved.
  const volatile = !snapshot && platform.kind === 'tauri';
  const service = createMemoryNotesService({ seed: await seedFrom(platform), snapshot, volatile });
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
