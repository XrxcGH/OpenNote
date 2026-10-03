// The Phase 2 notes snapshot (ARCHITECTURE.md section 12.3). Test builds keep the in-memory library, with its
// Trash, in %LOCALAPPDATA%\OpenNote\phase2-notes.json through platform.notesSnapshot, so a relaunch reopens the
// same tree. It uses the fixture shape, isn't a file format, has no migration, and goes away with the
// notes.memorySnapshot flag.
//
// Saves wait 1 s after the last change and flush() saves at once. A failed save leaves the changes unsaved and
// tries again on a timer (5 s, then doubling to 1 min) as well as on the next change or flush, until one works.

import { NotesError } from './errors';
import { parseFixture } from './fixtures';
import type { FixtureData, FixtureNode } from './fixtures';
import type { NotesSnapshotClient } from '../../platform/types';
import type { SaveStatus } from './types';

/** One trashed root, with where it came from. `nodes` is the root, then its subpages for a page. */
export interface SnapshotTrashItem {
  readonly receiptId: string;
  readonly trashedAt: string;
  readonly parentId: string | null;
  readonly beforeId: string | null;
  readonly parentTitle: string;
  readonly notebookId: string | null;
  readonly nodes: readonly FixtureNode[];
}

export interface SnapshotData extends FixtureData {
  /** Oldest first. */
  readonly trash?: readonly SnapshotTrashItem[];
}

export const SNAPSHOT_DEBOUNCE_MS = 1000;
/** The wait before the first retry of a failed save. Each failure in a row doubles it, up to the maximum. */
export const SNAPSHOT_RETRY_MS = 5000;
export const SNAPSHOT_RETRY_MAX_MS = 60_000;

const optionalText = (value: unknown) => value === null || typeof value === 'string';

function isTrashItem(value: unknown): value is SnapshotTrashItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  const nodes = item.nodes;
  return (
    typeof item.receiptId === 'string' &&
    typeof item.trashedAt === 'string' &&
    typeof item.parentTitle === 'string' &&
    [item.parentId, item.beforeId, item.notebookId].every(optionalText) &&
    Array.isArray(nodes) &&
    nodes.length > 0 &&
    parseFixture(JSON.stringify({ folder: '', notebooks: nodes })) !== null
  );
}

/** Reads a saved snapshot, or seed fixture JSON. Returns null for anything else. Bad Trash items are dropped. */
export function parseSnapshot(json: string): SnapshotData | null {
  const data = parseFixture(json) as (FixtureData & { trash?: unknown }) | null;
  if (!data) return null;
  const trash = Array.isArray(data.trash) ? data.trash.filter(isTrashItem) : [];
  return { ...data, trash };
}

export interface SnapshotSaver {
  /** Saves after the debounce. */
  changed(): void;
  /** Saves now, and resolves when every change is saved; rejects with NotesError 'io' when saving fails. */
  flush(): Promise<void>;
  status(): SaveStatus;
  hasUnsaved(): boolean;
}

interface SaverOptions {
  debounceMs?: number;
  retryMs?: number;
  onStatus(status: SaveStatus): void;
}

/** What a rejected save says. Rust's errors are plain `{ code, message }` objects, which String() would hide. */
function reasonOf(error: unknown): string {
  const message = typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined;
  return typeof message === 'string' ? message : String(error);
}

class Saver implements SnapshotSaver {
  private dirty = false;
  private failed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private reported: SaveStatus = 'saved';
  private retryDelay: number;
  private readonly client: NotesSnapshotClient;
  private readonly serialize: () => string;
  private readonly options: SaverOptions;

  constructor(client: NotesSnapshotClient, serialize: () => string, options: SaverOptions) {
    this.client = client;
    this.serialize = serialize;
    this.options = options;
    this.retryDelay = options.retryMs ?? SNAPSHOT_RETRY_MS;
  }

  status(): SaveStatus {
    return this.failed ? 'error' : this.dirty || this.saving ? 'saving' : 'saved';
  }

  hasUnsaved(): boolean {
    return this.dirty || this.saving !== null;
  }

  changed(): void {
    this.dirty = true;
    this.report();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush().catch(() => {}), this.options.debounceMs ?? SNAPSHOT_DEBOUNCE_MS);
  }

  /** Saves until nothing is left to save; a change during a save starts another one. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (;;) {
      if (this.saving) await this.saving.catch(() => {});
      else if (this.dirty) await this.saveOnce();
      else return;
    }
  }

  private async saveOnce(): Promise<void> {
    this.dirty = false;
    this.saving = this.client.save(this.serialize());
    this.report();
    try {
      await this.saving;
      this.failed = false;
      this.retryDelay = this.options.retryMs ?? SNAPSHOT_RETRY_MS;
    } catch (error) {
      this.dirty = true;
      this.failed = true;
      this.scheduleRetry();
      const reason = reasonOf(error);
      throw new NotesError('io', `Couldn't save the notes snapshot: ${reason}`, undefined, reason);
    } finally {
      this.saving = null;
      this.report();
    }
  }

  /** Tries a failed save again after a wait that doubles, unless a save is already due. */
  private scheduleRetry(): void {
    if (this.timer) return;
    const wait = this.retryDelay;
    this.retryDelay = Math.min(wait * 2, SNAPSHOT_RETRY_MAX_MS);
    this.timer = setTimeout(() => void this.flush().catch(() => {}), wait);
  }

  private report(): void {
    const next = this.status();
    if (next === this.reported) return;
    this.reported = next;
    this.options.onStatus(next);
  }
}

/** The detail on the error flush() rejects with when nothing keeps the notes, so the interface can say so. */
export const NOT_KEPT = 'not-kept';

/**
 * The saver for a library that nothing keeps, which is the Phase 2 library on a channel without the snapshot.
 * The first change leaves it unsaved for good: the title bar says so, and the window can't close without the
 * person agreeing to lose the notes.
 */
export function createVolatileSaver(onStatus: (status: SaveStatus) => void): SnapshotSaver {
  let changed = false;
  return {
    changed() {
      if (changed) return;
      changed = true;
      onStatus('error');
    },
    flush: () =>
      changed
        ? Promise.reject(new NotesError('io', 'Nothing keeps these notes after the app closes.', undefined, NOT_KEPT))
        : Promise.resolve(),
    status: () => (changed ? 'error' : 'saved'),
    hasUnsaved: () => changed,
  };
}

export function createSnapshotSaver(
  client: NotesSnapshotClient,
  serialize: () => string,
  options: SaverOptions,
): SnapshotSaver {
  return new Saver(client, serialize, options);
}
