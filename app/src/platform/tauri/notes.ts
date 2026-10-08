// The notes bridge's commands and events (app/src-tauri/src/notes), for the notes service over the core.

import { listen as tauriListen } from '@tauri-apps/api/event';
import type { NotesCoreClient } from '../../services/notes/core/service';
import type { NotesEvent } from '../../services/notes/types';
import { invoke } from './invoke';

const anyInvoke = invoke as (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function createTauriNotesCore(): NotesCoreClient {
  return {
    invoke: (command, args) => anyInvoke(command, args),
    listen(handler) {
      let stopped = false;
      let stop: (() => void) | null = null;
      tauriListen<NotesEvent>('notes:event', ({ payload }) => handler(payload))
        .then((unlisten) => (stopped ? unlisten() : (stop = unlisten)))
        .catch((error: unknown) => console.debug(`notes:event: ${String(error)}`));
      return () => {
        stopped = true;
        stop?.();
      };
    },
  };
}
