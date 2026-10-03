// The recordings of the shown page, by ID (Phase 9). The core can't edit a block of a type it doesn't know, so the
// block only says where a recording sits on the page. Its entry is kept in the page's view, under `recordings`,
// which the core edits and keeps (crates/media/src/README.md, "What the note format needs"). This store holds those
// entries for the screens, and follows the page's own changes, such as an undo.
import type { RecordingEntry } from '../../../core/audio';
import type { OpenPage } from '../../../services/pages/types';
import { createStore } from '../../../state/store';

export const recordingEntries = createStore<ReadonlyMap<string, RecordingEntry>>(new Map(), 'audio recording entries');

const isEntry = (value: unknown): value is RecordingEntry =>
  typeof value === 'object' && value !== null && typeof (value as RecordingEntry).id === 'string';

/** The entries a page view holds. */
export function entriesOf(view: unknown): RecordingEntry[] {
  const held = (view as { recordings?: Record<string, unknown> } | null | undefined)?.recordings;
  return held && typeof held === 'object' ? Object.values(held).filter(isEntry) : [];
}

let adopted: { page: string; stop: () => void } | null = null;

/** Takes the page's recordings, and follows its changes, until another page is adopted. */
export function adoptPage(page: OpenPage): void {
  if (adopted?.page === page.id) return;
  adopted?.stop();
  recordingEntries.set(new Map(entriesOf(page.initial.view).map((entry) => [entry.id, entry])));
  const stop = page.onFrame((frame) => {
    const changed = entriesOf(frame.page?.view);
    if (changed.length === 0) return;
    setEntries(changed);
    // An undo can take a finished recording back to the state of one that runs. Its files are complete, so it is
    // recovered the way a crash is.
    if (changed.some((entry) => entry.state === 'recording')) {
      void import('./recover').then((module) => module.recoverEntries(page, changed));
    }
  });
  adopted = { page: page.id, stop };
}

export function setEntries(entries: readonly RecordingEntry[]): void {
  recordingEntries.set(
    (held) => new Map([...held, ...entries.map((entry): [string, RecordingEntry] => [entry.id, entry])]),
  );
}

export function removeEntry(id: string): void {
  recordingEntries.set((held) => new Map([...held].filter(([key]) => key !== id)));
}

export const entryOf = (id: string | null | undefined): RecordingEntry | null =>
  (id ? recordingEntries.get().get(id) : null) ?? null;
