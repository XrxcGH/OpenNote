// The tree's undo stack (ARCHITECTURE.md section 13.1) keeps the last 20 tree changes, so they can be undone.
// Ctrl+Z and Ctrl+Y reach it through edit.undo and edit.redo, even after an Undo toast is gone. Phase 3 replaces
// it with the core's history; the call sites stay.

import type { NotesService } from '../../services/notes';
import { createStore } from '../../state/store';
import { announce } from '../../ui';

export const UNDO_LIMIT = 20;

export interface UndoEntry {
  /** Announced after undoing, such as 'Restored "Mitosis".' */
  readonly undone: string;
  /** Announced after redoing. */
  readonly redone: string;
  undo(notes: NotesService): Promise<void>;
  redo(notes: NotesService): Promise<void>;
}

export const undoStore = createStore<{ past: readonly UndoEntry[]; future: readonly UndoEntry[] }>(
  { past: [], future: [] },
  'tree undo',
);

export function recordUndo(entry: UndoEntry): void {
  undoStore.set((state) => ({ past: [...state.past, entry].slice(-UNDO_LIMIT), future: [] }));
}

export const canUndo = () => undoStore.get().past.length > 0;
export const canRedo = () => undoStore.get().future.length > 0;

let busy = false;

/** Undoes the last tree change. Resolves false when there was none, or when an undo or redo is still running. */
export async function undo(notes: NotesService): Promise<boolean> {
  const entry = undoStore.get().past.at(-1);
  if (!entry || busy) return false;
  busy = true;
  const message = entry.undone;
  undoStore.set((state) => ({ past: state.past.slice(0, -1), future: state.future }));
  try {
    await entry.undo(notes);
    undoStore.set((state) => ({ past: state.past, future: [entry, ...state.future] }));
    announce(message);
    return true;
  } finally {
    busy = false;
  }
}

export async function redo(notes: NotesService): Promise<boolean> {
  const entry = undoStore.get().future[0];
  if (!entry || busy) return false;
  busy = true;
  const message = entry.redone;
  undoStore.set((state) => ({ past: state.past, future: state.future.slice(1) }));
  try {
    await entry.redo(notes);
    undoStore.set((state) => ({ past: [...state.past, entry].slice(-UNDO_LIMIT), future: state.future }));
    announce(message);
    return true;
  } finally {
    busy = false;
  }
}
