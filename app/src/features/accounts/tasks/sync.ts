// The two-way sync of tasks. It remembers, for each linked task, what both sides held after the last sync (the base). A
// side that differs from the base has changed. A change on one side only is copied to the other. When both changed, the
// newer change wins, and the other copy is written to the conflict log so nothing is lost silently. A task deleted on
// one side is deleted on the other only if the other has not changed since; otherwise the change brings it back.
//
// The function does the work against a service's API and the local list, both passed in, and returns the new state for
// the caller to save, so the whole thing is tested without a service or a screen.
import type { Conflict, Link, LocalTask, LocalTasks, SyncResult, TaskFields, TasksApi, TasksState } from './types';

const MAX_CONFLICTS = 50;

export const fieldsOf = (task: TaskFields): TaskFields => ({
  title: task.title,
  done: task.done,
  date: task.date,
  time: task.time,
});

export const sameFields = (a: TaskFields, b: TaskFields): boolean =>
  a.title === b.title && a.done === b.done && a.date === b.date && a.time === b.time;

/** The local ID of a task that came from the service. */
export const localIdFor = (service: string, remote: string): string => `${service}:${remote}`;

export interface SyncOptions {
  api: TasksApi;
  local: LocalTasks;
  state: TasksState;
  now?: number;
}

export async function syncTasks(options: SyncOptions): Promise<{ state: TasksState; result: SyncResult }> {
  const { api, local } = options;
  const now = options.now ?? Date.now();
  const stamp = new Date(now).toISOString();
  const state: TasksState = structuredClone(options.state);
  const result: SyncResult = { pulled: 0, pushed: 0, removed: 0, conflicts: 0 };
  const remote = new Map((await api.list()).map((task) => [task.id, task]));
  const here = new Map(local.read().map((task) => [task.id, task]));
  const put: LocalTask[] = [];
  const drop: string[] = [];

  const modified = (id: string): number => {
    const known = local.modifiedAt?.(id);
    if (typeof known === 'number') return known;
    state.seen[id] ??= now;
    return state.seen[id] ?? now;
  };
  const conflict = (entry: Conflict) => {
    state.conflicts = [entry, ...state.conflicts].slice(0, MAX_CONFLICTS);
    result.conflicts += 1;
  };
  const link = (id: string, remoteId: string, base: TaskFields) => {
    state.links[id] = { remote: remoteId, base: fieldsOf(base) } satisfies Link;
    delete state.seen[id];
  };

  const linkedRemote = new Set(Object.values(state.links).map((one) => one.remote));

  for (const [id, entry] of Object.entries(state.links)) {
    const mine = here.get(id);
    const theirs = remote.get(entry.remote);
    const base = entry.base;
    if (!mine && !theirs) {
      delete state.links[id];
      continue;
    }
    if (!mine && theirs) {
      // Deleted here. Gone there too, unless it changed there since.
      if (sameFields(theirs, base)) {
        await api.remove(theirs.id);
        delete state.links[id];
        result.removed += 1;
      } else {
        put.push({ id, ...fieldsOf(theirs) });
        link(id, theirs.id, theirs);
        result.pulled += 1;
        conflict({ at: stamp, title: theirs.title, kept: 'there', other: fieldsOf(base) });
      }
      continue;
    }
    if (mine && !theirs) {
      // Deleted there. Gone here too, unless it changed here since.
      if (sameFields(mine, base)) {
        drop.push(id);
        delete state.links[id];
        result.removed += 1;
      } else {
        const made = await api.create(fieldsOf(mine));
        link(id, made.id, mine);
        linkedRemote.add(made.id);
        result.pushed += 1;
        conflict({ at: stamp, title: mine.title, kept: 'here', other: fieldsOf(base) });
      }
      continue;
    }
    if (!mine || !theirs) continue;
    const changedHere = !sameFields(mine, base);
    const changedThere = !sameFields(theirs, base);
    if (!changedHere && !changedThere) continue;
    if (changedHere && changedThere && sameFields(mine, theirs)) {
      link(id, theirs.id, theirs);
      continue;
    }
    let pushHere = changedHere;
    if (changedHere && changedThere) {
      pushHere = modified(id) >= Date.parse(theirs.updated);
      conflict({
        at: stamp,
        title: pushHere ? mine.title : theirs.title,
        kept: pushHere ? 'here' : 'there',
        other: fieldsOf(pushHere ? theirs : mine),
      });
    }
    if (pushHere) {
      const updated = await api.update(theirs.id, fieldsOf(mine));
      link(id, updated.id, mine);
      result.pushed += 1;
    } else {
      put.push({ id, ...fieldsOf(theirs) });
      link(id, theirs.id, theirs);
      result.pulled += 1;
    }
  }

  // New there: bring it here.
  for (const task of remote.values()) {
    if (linkedRemote.has(task.id)) continue;
    const id = localIdFor(api.service, task.id);
    put.push({ id, ...fieldsOf(task) });
    link(id, task.id, task);
    result.pulled += 1;
  }

  // New here: send it there.
  for (const task of here.values()) {
    if (state.links[task.id]) continue;
    const made = await api.create(fieldsOf(task));
    link(task.id, made.id, task);
    result.pushed += 1;
  }

  if (put.length > 0 || drop.length > 0) local.write(put, drop);
  state.lastSync = stamp;
  return { state, result };
}
