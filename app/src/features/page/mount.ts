// Assembles a page view around an open page (owner after WP0: WP3): the viewport, the flow column, the block layer,
// the editor pool, the pointer router, the sync queue, and the frame context that applies undo and other windows'
// changes. PageView.tsx mounts it, and the test harness mounts it without React.
import { newId } from '../../editor/ids';
import type { EditorHost } from '../../editor/host';
import { createMarkdownCache } from '../../editor/markdown';
import type { MarkdownCache } from '../../editor/markdown';
import { beforeExit } from '../../registries';
import type { PageViewMode } from '../../platform/bindings/PageViewMode';
import type { AppliedFrame, BlockId, BlockJson, OpenPage } from '../../services/pages/types';
import { osStore } from '../../state/os';
import { announce } from '../../ui';
import { createBlockLayer } from './blocks/blockLayer';
import type { PageBlockLayer } from './blocks/blockLayer';
import { frameContext } from './blocks/frameContext';
import { markDraft } from './blocks/textBlock';
import { createEditorHost } from './editorHost';
import { createFlow } from './layout/flow';
import type { Flow } from './layout/flow';
import { createPageLayout } from './layout/actions';
import type { PageLayout } from './layout/actions';
import { createEditorPool, shownPool } from './pool/pool';
import type { PagePool } from './pool/pool';
import { createSelectTool } from './pool/selectTool';
import { savePageView } from './runtime';
import { setGeometrySource } from './seams/geometry';
import { selectOnPage } from './seams/selectionStore';
import { createSyncQueue, shownQueue } from './sync';
import type { SyncQueue } from './sync';
import type { Point } from './viewport/camera';
import { createGestureTool } from './viewport/gestures';
import { rememberView, restoreView } from './viewport/remember';
import { createRouter } from './viewport/router';
import type { PointerToolDef } from './viewport/router';
import { shownFitWidth, shownPage } from './viewport/shown';
import { createTitle } from './title/title';
import type { TitleBand } from './title/title';
import { createViewport, shownViewport } from './viewport/viewport';
import type { PageViewport } from './viewport/viewport';

export interface MountedPage {
  readonly page: OpenPage;
  readonly viewport: PageViewport;
  readonly flow: Flow;
  readonly layer: PageBlockLayer;
  readonly pool: PagePool;
  readonly sync: SyncQueue;
  readonly cache: MarkdownCache;
  readonly host: EditorHost;
  readonly title: TitleBand | null;
  readonly layout: PageLayout;
  /** Flushes, closes the page, and removes the view. */
  destroy(): Promise<void>;
}

export interface MountOptions {
  classNames: { viewport: string; world: string; underlay: string };
  host?: Partial<EditorHost>;
  /** The compact Reading view; by default it follows the size class, the page, and the saved choice. */
  reading?: boolean;
  /** The compact size class, where pages with floating blocks open in the Reading view. */
  compact?: boolean;
  /** The view this device last chose for the page. */
  savedView?: PageViewMode | null;
  /** The title band, inside the world. */
  title?: { text: string; changed: string | null };
  /** Called when undo or another window changes the title, tags, or view. */
  onPageFields?(fields: NonNullable<AppliedFrame['page']>): void;
  /** Whether the shown page's stores point at this view; tests that mount several pages turn it off. */
  shown?: boolean;
}

/** Pages with more blocks than this remember their heights. */
const LONG_PAGE_BLOCKS = 20;

/** An empty text box for a page with no text yet. It joins page.json with its first change. */
function draftTextBlock(): BlockJson {
  const now = new Date().toISOString();
  const id = newId();
  const block: BlockJson = { id, type: 'text', order: 'zz', created: now, modified: now, data: { markdown: '' } };
  return markDraft(block, { block: { id, type: 'text' } });
}

/** The block under a point in page units: a hit test, so only at pointer down. */
function blockAt(viewport: PageViewport, point: Point): BlockId | null {
  const client = viewport.toClient(point.x, point.y);
  const hit = viewport.viewport.ownerDocument.elementFromPoint?.(client.x, client.y) ?? null;
  const wrapper = hit && viewport.world.contains(hit) ? hit.closest<HTMLElement>('[data-block-id]') : null;
  return wrapper?.dataset.blockId ?? null;
}

/** Routes the page's pointers: Phase 4's tools for this page, and every registered one. */
function routePointers(viewport: PageViewport, tools: readonly PointerToolDef[]): () => void {
  return createRouter({
    element: viewport.viewport,
    camera: () => viewport.camera(),
    toWorld: (x, y) => viewport.toWorld(x, y),
    blockAt: (point) => blockAt(viewport, point),
    tools,
  });
}

/** Points the shown page's stores at this view. Returns a function that clears them if they still point here. */
function showPage(mounted: Omit<MountedPage, 'destroy'>): () => void {
  shownViewport.set(mounted.viewport);
  shownPage.set(mounted.layout);
  shownFitWidth.set(() => mounted.flow.fitWidth());
  shownQueue.set(mounted.sync);
  shownPool.set(mounted.pool);
  setGeometrySource((block) => mounted.layer.view(block)?.element ?? null);
  return () => {
    if (shownQueue.get() !== mounted.sync) return;
    shownQueue.set(null);
    shownPool.set(null);
    shownViewport.set(null);
    shownPage.set(null);
    shownFitWidth.set(null);
    setGeometrySource(null);
  };
}

/** Follows the screen reader: while one runs, the pool neither mounts in idle time nor demotes. */
function followScreenReader(pool: PagePool, host: EditorHost): () => void {
  const sync = () => pool.setScreenReader(host.screenReader());
  sync();
  return osStore.subscribe(sync);
}

/** Pages with floating blocks open in the Reading view in the compact size class, unless Canvas was chosen. */
function opensInReading(page: OpenPage, options: MountOptions): boolean {
  if (options.reading !== undefined) return options.reading;
  const floating = page.initial.blocks.some((block) => block.frame?.x !== undefined && block.frame?.y !== undefined);
  return (options.compact ?? false) && floating && options.savedView !== 'canvas';
}

interface TitleParts {
  readonly page: OpenPage;
  readonly sync: SyncQueue;
  readonly layer: PageBlockLayer;
  readonly pool: PagePool;
}

/** The title band, wired to send typing as setPage and to move into the page on Enter. */
function titleBand(world: HTMLElement, parts: TitleParts, options: MountOptions): TitleBand | null {
  if (!options.title) return null;
  const { page, sync, layer, pool } = parts;
  return createTitle(world, {
    title: options.title.text,
    changed: options.title.changed,
    readOnly: page.readOnly !== null,
    send(title) {
      void sync.send({ edits: [{ edit: 'setPage', title }], coalesce: { kind: 'typing', target: 'title' } });
    },
    enterPage() {
      const first = layer.blocks().find((block) => block.type === 'text');
      if (first) pool.mount(first.id, { kind: 'start' }, 'target');
    },
  });
}

export function mountPage(container: HTMLElement, page: OpenPage, options: MountOptions): MountedPage {
  const cache = createMarkdownCache();
  const viewport = createViewport(container, options.classNames);
  const flow = createFlow(viewport);
  flow.setView(page.initial.view);
  const reading = opensInReading(page, options);
  flow.setReading(reading);
  restoreView(page.id, viewport);
  const pool = createEditorPool();
  const host = createEditorHost(options.host);
  const frames = frameContext(pool, () => layer, {
    setPageFields(fields) {
      if (fields.view) {
        layout.setView(fields.view);
        layer.setPreferredOrder(fields.view.readingOrder ?? []);
      }
      if (fields.title !== undefined) title?.setTitle(fields.title);
      options.onPageFields?.(fields);
    },
    selectObjects: (blocks) => selectOnPage({ blocks, strokes: [] }),
  });
  const sync = createSyncQueue({ page, cache, frames, announce });
  const layer = createBlockLayer(flow.element, { page, host, viewport, pool, sync, cache, reading });
  layer.apply(page.initial);
  if (!page.readOnly && !page.initial.blocks.some((block) => block.type === 'text')) layer.upsert(draftTextBlock());
  const title = titleBand(viewport.world, { page, sync, layer, pool }, options);
  const compact = options.compact ?? false;
  const layout = createPageLayout({ page, sync, layer, pool, flow, viewport, compact, reading });
  const gestures = createGestureTool(viewport);
  const select = createSelectTool(pool, { world: viewport.world, pressEmpty: (point) => layout.pressEmpty(point) });
  const mounted = { page, viewport, flow, layer, pool, sync, cache, host, title, layout };
  const stops = [
    rememberView(page.id, viewport),
    routePointers(viewport, [gestures, select]),
    () => layout.stop(),
    () => title?.destroy(),
    () => gestures.destroy(),
    followScreenReader(pool, host),
    options.shown === false ? () => undefined : showPage(mounted),
    beforeExit.register({
      id: `page.flush.${page.client}`,
      order: 10,
      run: () => sync.flushAll('exit').then(() => ({ ok: true }) as const),
    }),
  ];
  pool.watch(viewport.viewport);
  return {
    ...mounted,
    async destroy() {
      await sync.flushAll('pageSwitch').catch(() => undefined);
      // Long pages remember their blocks' heights, so the next open holds their places before they render.
      const heights = layer.heights();
      if (Object.keys(heights).length > LONG_PAGE_BLOCKS) savePageView(page.id, { heights });
      stops.reverse().forEach((stop) => stop());
      pool.destroy();
      layer.destroy();
      flow.stop();
      viewport.destroy();
      await page.close().catch(() => undefined);
    },
  };
}
