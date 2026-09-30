// Chooses the notes service and makes it available to components (ARCHITECTURE.md section 12.5).
// WP0: the read-only stub, seeded from the notes snapshot when there is one, else from the sample library.
// WP6 replaces it with the in-memory service, and Phase 3's storage-backed service takes over behind storage.core.

import { createContext, createElement, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Platform } from '../../platform/types';
import { parseFixture } from './fixtures';
import type { NotesFixture } from './fixtures';
import { createStubNotesService } from './stub';
import type { NotesService } from './types';

export type * from './types';
export { NotesError, isNotesError } from './errors';

async function seedFrom(platform: Platform): Promise<NotesFixture> {
  const json = await platform.notesSnapshot?.load().catch(() => null);
  return (json && parseFixture(json)) || 'sample';
}

export async function createNotesService(platform: Platform): Promise<NotesService> {
  return createStubNotesService(await seedFrom(platform));
}

const NotesContext = createContext<NotesService | null>(null);

export function NotesProvider(props: { service: NotesService; children: ReactNode }) {
  return createElement(NotesContext.Provider, { value: props.service }, props.children);
}

export function useNotes(): NotesService {
  const service = useContext(NotesContext);
  if (!service) throw new Error('useNotes needs a NotesProvider.');
  return service;
}
