// The Phase 2 notes snapshot, which Rust keeps in %LOCALAPPDATA%\OpenNote\phase2-notes.json.

import type { NotesSnapshotClient } from '../types';
import { invoke } from './invoke';

export function createTauriSnapshot(): NotesSnapshotClient {
  return {
    load: () => invoke('notes_snapshot_load'),
    save: async (json) => void (await invoke('notes_snapshot_save', { json })),
  };
}
