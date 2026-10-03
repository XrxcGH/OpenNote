// The Phase 2 notes snapshot in a browser. Until something is saved, it holds the seed library as fixture JSON,
// which is also the snapshot's shape (services/notes/fixtures.ts).

import { resolveFixture } from '../../services/notes/fixtures';
import type { NotesFixture } from '../../services/notes/fixtures';
import type { NotesSnapshotClient } from '../types';
import { registerTestHook } from './testHooks';

export function createWebSnapshot(seed: NotesFixture): NotesSnapshotClient {
  let saved: string = JSON.stringify(resolveFixture(seed));
  registerTestHook('seedNotes', (fixture: NotesFixture) => (saved = JSON.stringify(resolveFixture(fixture))));
  registerTestHook('notesSnapshot', () => saved);
  return {
    load: () => Promise.resolve(saved),
    save(json) {
      saved = json;
      return Promise.resolve();
    },
  };
}
