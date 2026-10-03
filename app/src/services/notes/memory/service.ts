// The Phase 2 notes service (ARCHITECTURE.md section 12.3), the full contract over an in-memory library. Every
// call can wait a set delay, tests can make the next call fail, every change sends events, and test builds keep
// the Phase 2 snapshot.

import type { NotesSnapshotClient } from '../../../platform/types';
import { NotesError } from '../errors';
import type { NotesErrorCode } from '../errors';
import { resolveFixture } from '../fixtures';
import type { NotesFixture } from '../fixtures';
import { createSnapshotSaver, createVolatileSaver } from '../snapshot';
import type { SnapshotData, SnapshotSaver } from '../snapshot';
import type { InitialTree, NodeId, NodeSummary, NotesEvent, NotesService, SaveStatus } from '../types';
import type { Library } from './library';
import { fromSnapshot, toSnapshot } from './persist';
import { listTrash, restore, restoreFromTrash, trash } from './trash';
import { create, move, rename, setColor, setPageLevel } from './writes';

export interface MemoryNotesOptions {
  /** A fixture name, fixture data, or a saved snapshot. */
  seed: NotesFixture | SnapshotData;
  /** A delay on every call, to exercise loading states and optimistic updates. */
  latencyMs?: number;
  /** Phase 2 test builds: persist across restarts. */
  snapshot?: NotesSnapshotClient;
  snapshotDebounceMs?: number;
  /**
   * Nothing keeps the library when the app closes, so the first change counts as unsaved for good. Without a
   * snapshot and without this, the service is a plain in-memory library and has nothing to save.
   */
  volatile?: boolean;
  /** The clock for created, modified, and trashed times. */
  now?: () => string;
}

export interface MemoryNotesService extends NotesService {
  /** Tests: the next call fails with this code. */
  failNext(code: NotesErrorCode): void;
}

const PREFIX = { notebook: 'n', sectionGroup: 'g', section: 's', page: 'p', receipt: 't' } as const;

function idMaker(): (kind: keyof typeof PREFIX) => string {
  const salt = Math.random().toString(36).slice(2, 8);
  let counter = 0;
  return (kind) => `${PREFIX[kind]}-${salt}${(counter += 1).toString(36)}`;
}

function loadInitial(lib: Library, path: readonly NodeId[]): InitialTree {
  const resolved: string[] = [];
  for (const id of path) {
    const parent = resolved.length ? resolved[resolved.length - 1] : null;
    if (!lib.isLive(id) || lib.any(id).parentId !== parent) break;
    resolved.push(id);
  }
  const containers = resolved.filter((id) => lib.any(id).kind !== 'page');
  const last = resolved.length ? lib.any(resolved[resolved.length - 1]) : null;
  return {
    library: { folder: lib.folder, readOnly: lib.readOnly },
    notebooks: lib.summaries(lib.kidsOf(null)),
    children: Object.fromEntries(containers.map((id) => [id, lib.summaries(lib.kidsOf(id))])),
    resolvedPath: resolved as NodeId[],
    page: last?.kind === 'page' ? lib.summary(last) : null,
  };
}

/** Events for a change: the changed nodes and parents, then a re-list of each parent whose children changed. */
function changeEvents(lib: Library, nodes: readonly string[], parents: readonly (string | null)[]): NotesEvent[] {
  const unique = [...new Set(parents)];
  const touched = [...new Set([...nodes, ...unique.filter((id): id is string => id !== null)])];
  const live = touched.filter((id) => lib.isLive(id));
  return [
    ...(live.length ? [{ type: 'upserted', nodes: lib.summaries(live) } as const] : []),
    ...unique.map((parentId): NotesEvent => ({ type: 'childrenChanged', parentId: parentId as NodeId | null })),
  ];
}

interface Runner {
  readonly lib: Library;
  readonly newId: ReturnType<typeof idMaker>;
  now(): string;
  /** Answers after the delay, unless the call was set to fail. */
  call<T>(work: () => T): Promise<T>;
  /** Makes a change, then tells listeners and schedules the snapshot. */
  change<T>(work: () => T, describe: (result: T) => NotesEvent[]): Promise<T>;
}

function createRunner(
  options: MemoryNotesOptions,
  emit: (events: NotesEvent[]) => void,
  saver: () => SnapshotSaver | null,
) {
  let failure: NotesErrorCode | null = null;
  const runner: Runner = {
    lib: fromSnapshot(resolveFixture(options.seed)),
    newId: idMaker(),
    now: options.now ?? (() => new Date().toISOString()),
    async call(work) {
      if (options.latencyMs) await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
      const code = failure;
      failure = null;
      if (code) throw new NotesError(code, `The call failed on request (failNext ${code}).`);
      try {
        return work();
      } catch (error) {
        throw error instanceof NotesError ? error : new NotesError('io', String(error));
      }
    },
    change: (work, describe) =>
      runner.call(() => {
        const result = work();
        emit(describe(result));
        saver()?.changed();
        return result;
      }),
  };
  return { runner, failNext: (code: NotesErrorCode) => void (failure = code) };
}

type Reads = Pick<NotesService, 'loadInitial' | 'listNotebooks' | 'listChildren' | 'get' | 'listTrash'>;

function reads({ lib, call }: Runner): Reads {
  return {
    loadInitial: (path) => call(() => loadInitial(lib, path)),
    listNotebooks: () => call(() => lib.summaries(lib.kidsOf(null))),
    listChildren: (parentId) =>
      call(() => (lib.live(parentId).kind === 'page' ? [] : lib.summaries(lib.kidsOf(parentId)))),
    get: (id) => call(() => (lib.isLive(id) ? lib.summary(lib.any(id)) : null)),
    listTrash: () => call(() => listTrash(lib)),
  };
}

type Writes = Pick<NotesService, 'create' | 'rename' | 'setColor' | 'move' | 'setPageLevel'>;

function writes({ lib, change, newId, now }: Runner): Writes {
  const parentOf = (id: string) => lib.nodes.get(id)?.parentId ?? null;
  const upsert = (node: NodeSummary) => changeEvents(lib, [node.id], []);
  return {
    create: (input) =>
      change(
        () => lib.summary(create(lib, input, newId(input.kind), now())),
        (node) => changeEvents(lib, [node.id], [node.parentId]),
      ),
    rename: (id, title) => change(() => lib.summary(rename(lib, id, title, now())), upsert),
    setColor: (id, color) => change(() => lib.summary(setColor(lib, id, color, now())), upsert),
    move: async (ids, placement) => {
      const moved = () => {
        const sources = ids.map(parentOf);
        move(lib, ids, placement);
        return sources;
      };
      await change(moved, (sources) => changeEvents(lib, ids, [...sources, placement.parentId]));
    },
    setPageLevel: (ids, level) =>
      change(
        () => setPageLevel(lib, ids, level),
        () => changeEvents(lib, [], ids.map(parentOf)),
      ),
  };
}

type TrashCalls = Pick<NotesService, 'trash' | 'restore' | 'restoreFromTrash'>;

function trashCalls({ lib, change, newId, now }: Runner): TrashCalls {
  const parentOf = (id: string) => lib.nodes.get(id)?.parentId ?? null;
  const maker = () => ({ newId: () => newId('section'), now: now() });
  const restored = (nodes: NodeSummary[]) => {
    const parents = nodes.flatMap((node) => [node.parentId, lib.notebookOf(node.id)]);
    return changeEvents(
      lib,
      nodes.map((node) => node.id),
      parents,
    );
  };
  return {
    trash: async (ids) => {
      const work = () => ({
        sources: ids.map(parentOf),
        receipt: trash(lib, ids, { receiptId: newId('receipt'), now: now() }),
      });
      const { receipt } = await change(work, ({ sources, receipt }) => [
        { type: 'removed', ids: receipt.nodeIds },
        ...changeEvents(lib, [], sources),
      ]);
      return receipt;
    },
    restore: (receiptId) => change(() => restore(lib, receiptId, maker()), restored),
    restoreFromTrash: (ids) => change(() => restoreFromTrash(lib, ids, maker()), restored),
  };
}

export function createMemoryNotesService(options: MemoryNotesOptions): MemoryNotesService {
  const listeners = new Set<(event: NotesEvent) => void>();
  const emit = (events: NotesEvent[]) => events.forEach((event) => [...listeners].forEach((listen) => listen(event)));
  let saver: SnapshotSaver | null = null;
  const { runner, failNext } = createRunner(options, emit, () => saver);
  const onStatus = (status: SaveStatus) => emit([{ type: 'status', status }]);
  if (options.snapshot) {
    saver = createSnapshotSaver(options.snapshot, () => JSON.stringify(toSnapshot(runner.lib)), {
      debounceMs: options.snapshotDebounceMs,
      onStatus,
    });
  } else if (options.volatile) {
    saver = createVolatileSaver(onStatus);
  }
  return {
    contractVersion: 1,
    failNext,
    ...reads(runner),
    ...writes(runner),
    ...trashCalls(runner),
    saveStatus: () => saver?.status() ?? 'saved',
    hasUnsavedChanges: () => saver?.hasUnsaved() ?? false,
    flush: () => saver?.flush() ?? Promise.resolve(),
    watch(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
