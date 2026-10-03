// One open page in the memory page service (owner: WP2): a client with its own undo stacks, as in Phase 3's core.
// Other clients of the page get a frame for each change it makes.
import { newId } from '../../../editor/ids';
import { PageServiceError } from '../types';
import type {
  AppliedFrame,
  AssetId,
  AssetJson,
  EditBatch,
  ExternalChange,
  ImportedAsset,
  OpenPage,
  PageHistory,
  PageId,
  PageJson,
  ReadOnlyInfo,
  TxnAck,
} from '../types';
import { applyEdit, editableCopy } from './apply';
import type { ByteSplice } from './apply';
import { createUndoStacks, diffFrame, revert } from './history';
import type { UndoStacks } from './history';
import { imageSize } from './imageSize';
import { withBlocksFrom } from './versions';
import type { Versions } from './versions';

/** What the service tells each open client. */
export interface Client {
  frame(make: (canUndo: boolean, canRedo: boolean) => AppliedFrame): void;
  external(change: ExternalChange): void;
  readOnly(info: ReadOnlyInfo | null): void;
}

/** One page as the service holds it. */
export interface PageState {
  page: PageJson;
  bytes: Map<AssetId, Uint8Array>;
  urls: Map<AssetId, string>;
  sent: EditBatch[];
  clients: Set<Client>;
  seq: number;
  readOnly: ReadOnlyInfo | null;
  versions: Versions;
}

/** What a client's parts share. */
interface Ctx {
  state: PageState;
  stacks: UndoStacks;
  /** Null while the client may change the page, or the error that says why not. */
  refused(): PageServiceError | null;
  /** Moves the page to `next` and tells the other clients. */
  move(next: PageJson): void;
  /** Moves the page to `next`, tells the other clients, and makes this client's frame. */
  swap(next: PageJson, ui: AppliedFrame['ui']): AppliedFrame;
}

const notImplemented = (what: string) =>
  Promise.reject(new PageServiceError('notImplemented', `${what} isn't in the memory page service.`));

const conflict = () =>
  new PageServiceError('precondition', 'Another window changed this since, so it was dropped.', false);

async function importBytes(state: PageState, bytes: ArrayBuffer, name: string, mime: string): Promise<ImportedAsset> {
  const data = new Uint8Array(bytes.slice(0));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const id = newId();
  const asset: AssetJson = {
    file: `${id}.${mime.split('/')[1] ?? 'bin'}`,
    mime,
    bytes: data.length,
    sha256,
    name,
    created: new Date().toISOString(),
    ...imageSize(data),
  };
  state.bytes.set(id, data);
  state.page = { ...state.page, assets: { ...state.page.assets, [id]: asset } };
  return { id, asset };
}

function assetUrl(state: PageState, asset: AssetId): string {
  const bytes = state.bytes.get(asset);
  if (!bytes) return '';
  let url = state.urls.get(asset);
  if (!url) {
    url = URL.createObjectURL(new Blob([bytes.slice(0)], { type: state.page.assets[asset]?.mime }));
    state.urls.set(asset, url);
  }
  return url;
}

/** The order keys of the blocks a batch placed. */
function placed(page: PageJson, batch: EditBatch): Record<string, string> {
  const ids = batch.edits.flatMap((edit) => {
    if (edit.edit === 'insertBlock') return [edit.block.id];
    return edit.edit === 'moveBlock' && (edit.after ?? edit.before) ? [edit.block] : [];
  });
  return Object.fromEntries(ids.map((id) => [id, page.blocks.find((block) => block.id === id)?.order ?? '']));
}

function send(ctx: Ctx, splices: boolean, batch: EditBatch): Promise<TxnAck> {
  const { state, stacks } = ctx;
  const refused = ctx.refused();
  if (refused) return Promise.reject(refused);
  if (!splices && batch.edits.some((edit) => edit.edit === 'spliceText')) {
    return Promise.reject(new PageServiceError('invalid', 'This core takes setText, not spliceText.', false));
  }
  const before = state.page;
  const next = editableCopy(before);
  const now = new Date().toISOString();
  const made: { block: string; splice: ByteSplice }[] = [];
  let changed = false;
  try {
    for (const edit of batch.edits) {
      const splice = applyEdit(next, edit, now);
      const text = edit.edit === 'setText' || edit.edit === 'spliceText';
      if (splice && text) made.push({ block: edit.block, splice });
      changed ||= !text || splice !== null;
    }
  } catch (error) {
    return Promise.reject(error);
  }
  state.sent.push(structuredClone(batch));
  if (changed) {
    stacks.record(before, next, { batch: structuredClone(batch), splices: made }, Date.now());
    ctx.move(next);
  }
  const ack = { seq: ++state.seq, orderKeys: placed(next, batch) };
  return Promise.resolve({ ...ack, canUndo: stacks.canUndo(), canRedo: stacks.canRedo() });
}

function step(ctx: Ctx, direction: 'undo' | 'redo'): Promise<AppliedFrame | null> {
  const { state, stacks } = ctx;
  const refused = ctx.refused();
  if (refused) return Promise.reject(refused);
  const top = direction === 'undo' ? stacks.peekUndo() : stacks.peekRedo();
  if (!top) return Promise.resolve(null);
  const [from, to] = direction === 'undo' ? [top.after, top.before] : [top.before, top.after];
  const next = revert(state.page, from, to);
  if (!next) {
    if (direction === 'undo') stacks.dropUndo();
    else stacks.dropRedo();
    return Promise.reject(conflict());
  }
  if (direction === 'undo') stacks.undo();
  else stacks.redo();
  return Promise.resolve(ctx.swap(next, top.ui ?? null));
}

function history(ctx: Ctx, copy: (page: PageJson) => PageId): PageHistory {
  const { state, stacks } = ctx;
  const writable = () => {
    const refused = ctx.refused();
    if (refused) throw refused;
  };
  return {
    list: () => Promise.resolve(state.versions.list()),
    open: (revision) => Promise.resolve().then(() => structuredClone(state.versions.get(revision).page)),
    async restore(revision, asCopy) {
      const version = state.versions.get(revision);
      if (asCopy) return { page: copy(version.page), asCopy: true };
      writable();
      const next = { ...structuredClone(version.page), id: state.page.id };
      stacks.push(state.page, next, Date.now());
      ctx.swap(next, null);
      return { page: state.page.id, asCopy: false };
    },
    async restoreBlocks(revision, blocks) {
      const version = state.versions.get(revision);
      writable();
      const next = withBlocksFrom(state.page, version.page, blocks);
      stacks.push(state.page, next, Date.now());
      return ctx.swap(next, null);
    },
    async name(revision, name, keep) {
      state.versions.name(revision, name, keep);
    },
  };
}

function listeners<T>() {
  const set = new Set<(value: T) => void>();
  return {
    emit: (value: T) => set.forEach((listener) => listener(value)),
    listen(listener: (value: T) => void) {
      set.add(listener);
      return () => void set.delete(listener);
    },
  };
}

export function openClient(
  state: PageState,
  client: string,
  splices: boolean,
  copy: (page: PageJson) => PageId,
): OpenPage {
  const stacks = createUndoStacks();
  const frames = listeners<AppliedFrame>();
  const external = listeners<ExternalChange>();
  const readOnly = listeners<ReadOnlyInfo | null>();
  const self: Client = {
    frame: (make) => frames.emit(make(stacks.canUndo(), stacks.canRedo())),
    external: external.emit,
    readOnly: readOnly.emit,
  };
  state.clients.add(self);
  let closed = false;
  /** Whether this client changed the page, so closing it keeps a version, as the core does at close. */
  let edited = false;
  const ctx: Ctx = {
    state,
    stacks,
    refused() {
      if (closed) return new PageServiceError('invalid', 'The page is closed.', false);
      return state.readOnly ? new PageServiceError('readOnly', state.readOnly.reason, false) : null;
    },
    move(next) {
      const before = state.page;
      edited = true;
      state.page = next;
      for (const other of state.clients) {
        if (other !== self) other.frame((u, r) => diffFrame(before, next, null, { canUndo: u, canRedo: r }));
      }
    },
    swap(next, ui) {
      const before = state.page;
      edited = true;
      ctx.move(next);
      return diffFrame(before, next, ui, { canUndo: stacks.canUndo(), canRedo: stacks.canRedo() });
    },
  };
  return {
    id: state.page.id,
    client,
    initial: structuredClone(state.page),
    readOnly: state.readOnly ? { ...state.readOnly } : null,
    supportsSplice: splices,
    send: (batch) => send(ctx, splices, batch),
    undo: () => step(ctx, 'undo'),
    redo: () => step(ctx, 'redo'),
    saveNow() {
      if (!closed) state.versions.save(state.page, 'save');
      return Promise.resolve();
    },
    importImage(source) {
      if (source.kind !== 'bytes') return notImplemented('Importing images by address or clipboard token');
      return importBytes(state, source.bytes, source.name, source.mime);
    },
    assetUrl: (asset) => assetUrl(state, asset),
    history: history(ctx, copy),
    onFrame: frames.listen,
    onExternal: external.listen,
    onReadOnly: readOnly.listen,
    close() {
      if (!closed && edited) state.versions.save(state.page, 'closed');
      closed = true;
      state.clients.delete(self);
      return Promise.resolve();
    },
  };
}
