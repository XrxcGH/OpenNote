// The in-memory page service (owner after WP0: WP2): the web platform's pages and every test's. Each open page is
// a client with its own undo stack, as in Phase 3's core, and other clients of the same page get frames for its
// changes. `sent` lists every batch a page received, so tests can check what the page view sends.
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
  PageService,
  ReadOnlyInfo,
  TxnAck,
} from '../types';
import { applyEdit } from './apply';
import { createUndoStacks, diffFrame } from './history';
import { imageSize } from './imageSize';

export interface PageFixture {
  page: PageJson;
  assets?: Record<AssetId, Uint8Array>;
}

export interface MemoryPageServiceOptions {
  /** The page to create for an ID the fixtures don't have. Without it, such an ID is notFound. */
  missing?: (pageId: PageId) => PageJson | null;
}

export type MemoryPageService = PageService & { sent(page: PageId): readonly EditBatch[] };

interface PageState {
  page: PageJson;
  bytes: Map<AssetId, Uint8Array>;
  urls: Map<AssetId, string>;
  sent: EditBatch[];
  clients: Set<{ frame(frame: (canUndo: boolean, canRedo: boolean) => AppliedFrame): void }>;
  seq: number;
}

const notImplemented = (what: string) =>
  Promise.reject(new PageServiceError('notImplemented', `${what} isn't in the memory page service yet.`));

function history(state: PageState): PageHistory {
  return {
    list: () => Promise.resolve([]),
    open: () => Promise.resolve(structuredClone(state.page)),
    restore: () => notImplemented('Restoring a version'),
    restoreBlocks: () => notImplemented('Restoring blocks'),
    name: () => notImplemented('Naming a version'),
  };
}

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
  state.page.assets[id] = asset;
  return { id, asset };
}

function openClient(state: PageState, client: string): OpenPage {
  const stacks = createUndoStacks();
  const frames = new Set<(frame: AppliedFrame) => void>();
  const external = new Set<(change: ExternalChange) => void>();
  const readOnly = new Set<(info: ReadOnlyInfo | null) => void>();
  const self = {
    frame: (make: (u: boolean, r: boolean) => AppliedFrame) =>
      frames.forEach((l) => l(make(stacks.canUndo(), stacks.canRedo()))),
  };
  state.clients.add(self);
  let closed = false;
  const listen = <T>(set: Set<T>, listener: T) => {
    set.add(listener);
    return () => void set.delete(listener);
  };
  const others = (make: (u: boolean, r: boolean) => AppliedFrame) =>
    state.clients.forEach((other) => other !== self && other.frame(make));
  const swap = (next: PageJson, ui: AppliedFrame['ui']): AppliedFrame => {
    const before = state.page;
    state.page = structuredClone(next);
    others((u, r) => diffFrame(before, state.page, null, { canUndo: u, canRedo: r }));
    return diffFrame(before, state.page, ui, { canUndo: stacks.canUndo(), canRedo: stacks.canRedo() });
  };
  return {
    id: state.page.id,
    client,
    initial: structuredClone(state.page),
    readOnly: null,
    supportsSplice: true,
    send(batch: EditBatch): Promise<TxnAck> {
      if (closed) return Promise.reject(new PageServiceError('invalid', 'The page is closed.'));
      const before = state.page;
      const next = structuredClone(before);
      const now = new Date().toISOString();
      try {
        batch.edits.forEach((edit) => applyEdit(next, edit, now));
      } catch (error) {
        return Promise.reject(error);
      }
      state.page = next;
      state.sent.push(structuredClone(batch));
      stacks.record(before, structuredClone(next), structuredClone(batch), Date.now());
      others((u, r) => diffFrame(before, next, null, { canUndo: u, canRedo: r }));
      const orderKeys = Object.fromEntries(
        batch.edits.flatMap((edit) =>
          edit.edit === 'insertBlock' ? [[edit.block.id, next.blocks.find((b) => b.id === edit.block.id)?.order]] : [],
        ),
      ) as Record<string, string>;
      return Promise.resolve({ seq: ++state.seq, orderKeys, canUndo: stacks.canUndo(), canRedo: stacks.canRedo() });
    },
    undo() {
      const step = stacks.undo();
      return Promise.resolve(step ? swap(step.before, step.batch.ui ?? null) : null);
    },
    redo() {
      const step = stacks.redo();
      return Promise.resolve(step ? swap(step.after, step.batch.ui ?? null) : null);
    },
    saveNow: () => Promise.resolve(),
    importImage(source) {
      if (source.kind !== 'bytes') return notImplemented('Importing images by address or clipboard token');
      return importBytes(state, source.bytes, source.name, source.mime);
    },
    assetUrl(asset) {
      const bytes = state.bytes.get(asset);
      if (!bytes) return '';
      let url = state.urls.get(asset);
      if (!url) {
        url = URL.createObjectURL(new Blob([bytes.slice(0)], { type: state.page.assets[asset]?.mime }));
        state.urls.set(asset, url);
      }
      return url;
    },
    history: history(state),
    onFrame: (listener) => listen(frames, listener),
    onExternal: (listener) => listen(external, listener),
    onReadOnly: (listener) => listen(readOnly, listener),
    close() {
      closed = true;
      state.clients.delete(self);
      return Promise.resolve();
    },
  };
}

export function createMemoryPageService(
  fixtures: readonly PageFixture[],
  options: MemoryPageServiceOptions = {},
): MemoryPageService {
  const pages = new Map<PageId, PageState>();
  const add = (page: PageJson, assets: Record<AssetId, Uint8Array> = {}) => {
    const state: PageState = {
      page: structuredClone(page),
      bytes: new Map(Object.entries(assets)),
      urls: new Map(),
      sent: [],
      clients: new Set(),
      seq: 0,
    };
    pages.set(page.id, state);
    return state;
  };
  fixtures.forEach((fixture) => add(fixture.page, fixture.assets));
  let clients = 0;
  return {
    open(pageId) {
      let state = pages.get(pageId);
      if (!state) {
        const made = options.missing?.(pageId);
        if (!made) return Promise.reject(new PageServiceError('notFound', `There is no page ${pageId}.`));
        state = add({ ...made, id: pageId });
      }
      return Promise.resolve(openClient(state, `main-${++clients}`));
    },
    sent: (page) => pages.get(page)?.sent ?? [],
  };
}
