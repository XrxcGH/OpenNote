// The notes service over Phase 3's core (ADR 0014; ARCHITECTURE.md section 12.5). Each method is one command of
// the app's notes bridge (app/src-tauri/src/notes). The bridge keeps the tree in the notes folder in the note
// format: a folder for each notebook, with its sections, pages, and Trash inside it. It sends the notes events.
//
// A tree change is on disk when its command resolves, so the service is saving only while a change is on its way.

import { NotesError } from '../errors';
import type { InvalidNameReason, NotesErrorCode } from '../errors';
import type {
  ChipColor,
  InitialTree,
  NodeId,
  NodeSummary,
  NotesEvent,
  NotesService,
  SaveStatus,
  TrashedItem,
  TrashReceipt,
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

function initialTree(tree: InitialTree): InitialTree {
  const children: Record<string, readonly NodeSummary[]> = {};
  for (const [id, list] of Object.entries(tree.children)) children[id] = nodes(list);
  return { ...tree, notebooks: nodes(tree.notebooks), children, page: tree.page ? node(tree.page) : null };
}

/** Calls, the save status while changes are on their way, and the listeners. */
class Bridge {
  private readonly listeners = new Set<(event: NotesEvent) => void>();
  private readonly writes = new Set<Promise<unknown>>();
  private failed = false;
  private reported: SaveStatus = 'saved';
  private stopListening: (() => void) | null = null;
  private readonly client: NotesCoreClient;

  constructor(client: NotesCoreClient) {
    this.client = client;
  }

  status(): SaveStatus {
    return this.writes.size > 0 ? 'saving' : this.failed ? 'error' : 'saved';
  }

  unsaved(): boolean {
    return this.writes.size > 0;
  }

  async read<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return (await this.client.invoke(command, args)) as T;
    } catch (error) {
      throw toNotesError(error);
    }
  }

  /** A change: saving until it settles. A refusal of the call itself isn't a failed save. */
  write<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const call = this.read<T>(command, args);
    this.writes.add(call);
    this.report();
    const settle = (error?: unknown) => {
      this.writes.delete(call);
      this.failed = error instanceof NotesError && (error.code === 'io' || error.code === 'unavailable');
      this.report();
    };
    call.then(() => settle(), settle);
    return call;
  }

  async flush(): Promise<void> {
    while (this.writes.size > 0) await Promise.allSettled([...this.writes]);
    await this.read('notes_flush');
  }

  watch(listener: (event: NotesEvent) => void): () => void {
    this.listeners.add(listener);
    this.stopListening ??= this.client.listen((raw) =>
      this.emit(raw.type === 'upserted' ? { ...raw, nodes: nodes(raw.nodes) } : raw),
    );
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;
      this.stopListening?.();
      this.stopListening = null;
    };
  }

  private emit(event: NotesEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private report(): void {
    const next = this.status();
    if (next === this.reported) return;
    this.reported = next;
    this.emit({ type: 'status', status: next });
  }
}

type Reads = Pick<NotesService, 'loadInitial' | 'listNotebooks' | 'listChildren' | 'get' | 'listTrash'>;

function reads(bridge: Bridge): Reads {
  return {
    loadInitial: async (path) => initialTree(await bridge.read<InitialTree>('notes_load_initial', { path })),
    listNotebooks: async () => nodes(await bridge.read<NodeSummary[]>('notes_list_notebooks')),
    listChildren: async (parentId) => nodes(await bridge.read<NodeSummary[]>('notes_list_children', { parentId })),
    get: async (id) => {
      const found = await bridge.read<NodeSummary | null>('notes_get', { id });
      return found ? node(found) : null;
    },
    listTrash: async () => {
      const items = await bridge.read<TrashedItem[]>('notes_list_trash');
      return items.map((item) => ({ ...item, node: node(item.node) }));
    },
  };
}

type Writes = Pick<
  CoreNotesService,
  | 'create'
  | 'rename'
  | 'setColor'
  | 'move'
  | 'setPageLevel'
  | 'trash'
  | 'restore'
  | 'restoreFromTrash'
  | 'purgeFromTrash'
>;

function writes(bridge: Bridge): Writes {
  const summary = async (command: string, args: Record<string, unknown>) =>
    node(await bridge.write<NodeSummary>(command, args));
  const summaries = async (command: string, args: Record<string, unknown>) =>
    nodes(await bridge.write<NodeSummary[]>(command, args));
  const done = async (command: string, args: Record<string, unknown>) => void (await bridge.write(command, args));
  return {
    create: (input) => summary('notes_create', { input }),
    rename: (id, title) => summary('notes_rename', { id, title }),
    setColor: (id, color) => summary('notes_set_color', { id, color }),
    move: (ids, placement) => done('notes_move', { ids, placement }),
    setPageLevel: (ids, level) => done('notes_set_page_level', { ids, level }),
    trash: (ids) => bridge.write<TrashReceipt>('notes_trash', { ids }),
    restore: (receiptId) => summaries('notes_restore', { receiptId }),
    restoreFromTrash: (ids) => summaries('notes_restore_from_trash', { ids }),
    purgeFromTrash: (ids) => done('notes_purge', { ids }),
  };
}

export function createCoreNotesService(client: NotesCoreClient): CoreNotesService {
  const bridge = new Bridge(client);
  return {
    contractVersion: 1,
    ...reads(bridge),
    ...writes(bridge),
    saveStatus: () => bridge.status(),
    hasUnsavedChanges: () => bridge.unsaved(),
    flush: () => bridge.flush(),
    watch: (listener) => bridge.watch(listener),
  };
}
