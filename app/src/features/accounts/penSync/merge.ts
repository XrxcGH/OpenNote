// Merging pen settings, one item at a time. An item is one pen (with its tool, color, and width), the order of the pens,
// or one choice about the drawing bar (the formatting bar, the hand, the ruler). Each device keeps what both sides held
// after the last sync (the base). An item that differs from the base has changed. A change on one side is copied to the
// other. A change on both sides keeps the newer one. An item removed on one side is removed on the other only if the
// other side did not change it. Nothing here touches a device or a service: it takes values and answers values.

export type Items = Record<string, unknown>;

export interface RemoteItem {
  value?: unknown;
  /** When the item was last changed, as an ISO time. */
  updated: string;
  deleted?: true;
}

export interface RemoteDoc {
  v: 1;
  items: Record<string, RemoteItem>;
}

export interface PenSyncState {
  /** For each item, what both sides held after the last sync. */
  base: Record<string, string>;
  /** When this device first saw its own change to an item that had not been sent yet. */
  seen: Record<string, number>;
  lastSync: string | null;
}

export const EMPTY_SYNC: PenSyncState = { base: {}, seen: {}, lastSync: null };

export interface MergeResult {
  doc: RemoteDoc;
  /** Values this device should take on. */
  apply: Items;
  /** Items this device should drop. */
  remove: string[];
  state: PenSyncState;
  pushed: number;
  pulled: number;
  /** Items changed on both sides, where the newer change won. */
  conflicts: number;
  /** Whether the file at the service needs writing. */
  dirty: boolean;
}

const hashOf = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));

export function mergeItems(
  local: Items,
  remote: RemoteDoc | null,
  previous: PenSyncState,
  now: number = Date.now(),
): MergeResult {
  const stamp = new Date(now).toISOString();
  const doc: RemoteDoc = { v: 1, items: { ...(remote?.items ?? {}) } };
  const state: PenSyncState = structuredClone(previous);
  const apply: Items = {};
  const remove: string[] = [];
  const firstWithFile = previous.lastSync === null && remote !== null;
  const out = { pushed: 0, pulled: 0, conflicts: 0, dirty: remote === null };

  const keys = new Set([...Object.keys(local), ...Object.keys(doc.items), ...Object.keys(state.base)]);
  for (const key of keys) {
    const mine = local[key];
    const theirs = doc.items[key];
    const hashMine = hashOf(mine);
    const hashTheirs = theirs && !theirs.deleted ? hashOf(theirs.value) : null;
    const base = state.base[key] ?? null;
    if (hashMine === hashTheirs) {
      if (hashMine === null) delete state.base[key];
      else state.base[key] = hashMine;
      delete state.seen[key];
      continue;
    }
    const changedHere = hashMine !== base;
    const changedThere = hashTheirs !== base;
    let push = changedHere;
    if (changedHere && changedThere) {
      state.seen[key] ??= now;
      // A device that has never synced has only its defaults, so on a first sync the account's settings win.
      push = !firstWithFile && (state.seen[key] ?? now) >= Date.parse(theirs?.updated ?? '1970-01-01T00:00:00Z');
      out.conflicts += 1;
    }
    if (push) {
      doc.items[key] = mine === undefined ? { deleted: true, updated: stamp } : { value: mine, updated: stamp };
      if (hashMine === null) delete state.base[key];
      else state.base[key] = hashMine;
      out.pushed += 1;
      out.dirty = true;
    } else if (hashTheirs === null) {
      remove.push(key);
      delete state.base[key];
      out.pulled += 1;
    } else {
      apply[key] = theirs?.value;
      state.base[key] = hashTheirs;
      out.pulled += 1;
    }
    delete state.seen[key];
  }
  state.lastSync = stamp;
  return { doc, apply, remove, state, ...out };
}
