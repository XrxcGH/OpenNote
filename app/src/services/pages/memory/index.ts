// The in-memory page service (owner: WP2): the web platform's pages and every test's. It keeps Phase 3's rules.
// Each open page is a client with its own undo stack, as client.ts says. A read-only page refuses edits. `sent`
// lists every batch a page received, so tests can check what the page view sends.
import { newId } from '../../../editor/ids';
import { PageServiceError } from '../types';
import type { AssetId, EditBatch, ExternalChange, PageId, PageJson, PageService, ReadOnlyInfo } from '../types';
import { openClient } from './client';
import { loadInkCodec } from './ink';
import type { PageState } from './client';
import { createVersions } from './versions';

export interface PageFixture {
  page: PageJson;
  assets?: Record<AssetId, Uint8Array>;
}

export interface MemoryPageServiceOptions {
  /** The page to create for an ID the fixtures don't have. Without it, such an ID is notFound. */
  missing?: (pageId: PageId) => PageJson | null;
  /** Pages that open read-only, as the core reports a damaged or locked page. */
  readOnly?: Readonly<Record<PageId, ReadOnlyInfo>>;
  /** Whether the pages take `spliceText` (P3-10). Default true. */
  supportsSplice?: boolean;
}

export type MemoryPageService = PageService & {
  sent(page: PageId): readonly EditBatch[];
  /** The page as the service holds it now, after every edit, undo, and redo. */
  held(page: PageId): PageJson | null;
  /** Makes a page read-only, or writable again with null, and tells its clients, as `core:read-only` does. */
  setReadOnly(page: PageId, info: ReadOnlyInfo | null): void;
  /** Replaces a page as another app would on disk, and tells its clients, as `core:external-change` does. */
  changeOnDisk(page: PageId, next: PageJson, action?: ExternalChange['action']): void;
};

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
      readOnly: options.readOnly?.[page.id] ?? null,
      versions: createVersions(),
    };
    state.versions.save(state.page, 'open');
    pages.set(page.id, state);
    return state;
  };
  fixtures.forEach((fixture) => add(fixture.page, fixture.assets));
  const copy = (page: PageJson): PageId => {
    const id = newId();
    add({ ...structuredClone(page), id });
    return id;
  };
  let clients = 0;
  const splices = options.supportsSplice ?? true;
  return {
    open(pageId) {
      let state = pages.get(pageId);
      if (!state) {
        const made = options.missing?.(pageId);
        if (!made) return Promise.reject(new PageServiceError('notFound', `There is no page ${pageId}.`, false));
        state = add({ ...made, id: pageId });
      }
      const opened = state;
      return loadInkCodec().then(() => openClient(opened, `main-${++clients}`, splices, copy));
    },
    sent: (page) => pages.get(page)?.sent ?? [],
    held: (page) => {
      const state = pages.get(page);
      return state ? structuredClone(state.page) : null;
    },
    setReadOnly(page, info) {
      const state = pages.get(page);
      if (!state) return;
      state.readOnly = info;
      state.clients.forEach((client) => client.readOnly(info));
    },
    changeOnDisk(page, next, action = 'reloaded') {
      const state = pages.get(page);
      if (!state) return;
      state.page = { ...structuredClone(next), id: page };
      state.clients.forEach((client) => client.external({ action }));
    },
  };
}
