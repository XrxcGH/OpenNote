// The notes service over Phase 3's core (ADR 0014; ARCHITECTURE.md section 12.5). Each method is one command of
// the app's notes bridge (app/src-tauri/src/notes), which keeps the tree in the notes folder in the note format:
// a folder for each notebook, with its sections, pages, and Trash inside it. The bridge sends the notes events.
//
// A tree change is on disk when its command resolves, so the service is saving only while a change is on its way.

import { NotesError } from '../errors';
import type { InvalidNameReason, NotesErrorCode } from '../errors';
import type {
  ChipColor,
  CreateInput,
  InitialTree,
  NodeId,
  NodeSummary,
  NotesEvent,
  NotesService,
  PageLevel,
  Placement,
  SaveStatus,
  TrashedItem,
  TrashReceipt,
  TrashReceiptId,
} from '../types';
import { CHIP_COLORS } from '../types';

/** The bridge's commands and events, which platform/tauri provides and the notes harness fakes in tests. */
export interface NotesCoreClient {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Listens for the bridge's notes events. The returned function stops listening. */
  listen(handler: (event: NotesEvent) => void): () => void;
}

/** The core service's calls beyond the contract. */
export interface CoreNotesService extends NotesService {
  /** Deletes Trash items for good. */
  purgeFromTrash(ids: readonly NodeId[]): Promise<void>;
}

const CODES: ReadonlySet<string> = new Set<NotesErrorCode>([
  'not-found',
  'invalid-name',
  'invalid-move',
  'read-only',
  'conflict',
  'unavailable',
  'io',
]);

/** A NotesError from what a command rejected with: `{ code, message, field }`, where field is a name's reason. */
export function toNotesError(error: unknown): NotesError {
  if (error instanceof NotesError) return error;
  const ipc = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    message?: unknown;
    field?: unknown;
  };
  const code = typeof ipc.code === 'string' && CODES.has(ipc.code) ? (ipc.code as NotesErrorCode) : 'io';
  const message = typeof ipc.message === 'string' ? ipc.message : String(error);
  const reason = code === 'invalid-name' && typeof ipc.field === 'string' ? ipc.field : undefined;
  return new NotesError(code, message, reason as InvalidNameReason | undefined);
}

const colorOf = (value: unknown): ChipColor | null =>
  CHIP_COLORS.includes(value as ChipColor) ? (value as ChipColor) : null;

/** A summary as the interface reads it: only pen names as colors, and none on pages. */
function node(raw: NodeSummary): NodeSummary {
  return { ...raw, color: raw.kind === 'page' ? null : colorOf(raw.color) };
}

const nodes = (list: readonly NodeSummary[]) => list.map(node);

function event(raw: NotesEvent): NotesEvent {
  return raw.type === 'upserted' ? { ...raw, nodes: nodes(raw.nodes) } : raw;
}

export function createCoreNotesService(client: NotesCoreClient): CoreNotesService {
  const listeners = new Set<(event: NotesEvent) => void>();
  const writes = new Set<Promise<unknown>>();
  let failed = false;
  let reported: SaveStatus = 'saved';
  let stopListening: (() => void) | null = null;

  const emit = (next: NotesEvent) => {
    for (const listener of [...listeners]) listener(next);
  };
  const status = (): SaveStatus => (writes.size > 0 ? 'saving' : failed ? 'error' : 'saved');
  const report = () => {
    const next = status();
    if (next === reported) return;
    reported = next;
    emit({ type: 'status', status: next });
  };

  const read = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      return (await client.invoke(command, args)) as T;
    } catch (error) {
      throw toNotesError(error);
    }
  };

  /** A change: saving until it settles. A refusal of the call itself isn't a failed save. */
  const write = <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const call = read<T>(command, args);
    writes.add(call);
    report();
    const settle = (ok: boolean, error?: unknown) => {
      writes.delete(call);
      if (ok) failed = false;
      else if (error instanceof NotesError && (error.code === 'io' || error.code === 'unavailable')) failed = true;
      report();
    };
    call.then(
      () => settle(true),
      (error: unknown) => settle(false, error),
    );
    return call;
  };

  return {
    contractVersion: 1,
    async loadInitial(path: readonly NodeId[]): Promise<InitialTree> {
      const tree = await read<InitialTree>('notes_load_initial', { path });
      const children: Record<string, readonly NodeSummary[]> = {};
      for (const [id, list] of Object.entries(tree.children)) children[id] = nodes(list);
      return {
        ...tree,
        notebooks: nodes(tree.notebooks),
        children,
        page: tree.page ? node(tree.page) : null,
      };
    },
    listNotebooks: async () => nodes(await read<NodeSummary[]>('notes_list_notebooks')),
    listChildren: async (parentId: NodeId) => nodes(await read<NodeSummary[]>('notes_list_children', { parentId })),
    get: async (id: NodeId) => {
      const found = await read<NodeSummary | null>('notes_get', { id });
      return found ? node(found) : null;
    },
    create: async (input: CreateInput) => node(await write<NodeSummary>('notes_create', { input })),
    rename: async (id: NodeId, title: string) => node(await write<NodeSummary>('notes_rename', { id, title })),
    setColor: async (id: NodeId, color: ChipColor | null) =>
      node(await write<NodeSummary>('notes_set_color', { id, color })),
    move: async (ids: readonly NodeId[], placement: Placement) => {
      await write('notes_move', { ids, placement });
    },
    setPageLevel: async (ids: readonly NodeId[], level: PageLevel) => {
      await write('notes_set_page_level', { ids, level });
    },
    trash: (ids: readonly NodeId[]) => write<TrashReceipt>('notes_trash', { ids }),
    restore: async (receiptId: TrashReceiptId) => nodes(await write<NodeSummary[]>('notes_restore', { receiptId })),
    listTrash: async () => {
      const items = await read<TrashedItem[]>('notes_list_trash');
      return items.map((item) => ({ ...item, node: node(item.node) }));
    },
    restoreFromTrash: async (ids: readonly NodeId[]) =>
      nodes(await write<NodeSummary[]>('notes_restore_from_trash', { ids })),
    purgeFromTrash: async (ids: readonly NodeId[]) => {
      await write('notes_purge', { ids });
    },
    saveStatus: status,
    hasUnsavedChanges: () => writes.size > 0,
    async flush() {
      while (writes.size > 0) await Promise.allSettled([...writes]);
      await read('notes_flush');
    },
    watch(listener: (event: NotesEvent) => void) {
      listeners.add(listener);
      stopListening ??= client.listen((raw) => emit(event(raw)));
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopListening?.();
          stopListening = null;
        }
      };
    },
  };
}
