// Assembles a page view around an open page (owner after WP0: WP3): the viewport, the block layer, the editor pool,
// the sync queue, and the frame context that applies undo and other windows' changes. PageView.tsx mounts it, and
// the test harness mounts it without React.
import type { Node as PMNode } from '@tiptap/pm/model';
import { newId } from '../../editor/ids';
import type { EditorHost } from '../../editor/host';
import { createMarkdownCache } from '../../editor/markdown';
import type { MarkdownCache } from '../../editor/markdown';
import { META_REMOTE } from '../../editor/meta';
import { beforeExit } from '../../registries';
import type { AppliedFrame, BlockId, BlockJson, OpenPage } from '../../services/pages/types';
import { announce } from '../../ui';
import { createBlockLayer } from './blocks/blockLayer';
import { markDraft, syncOf } from './blocks/textBlock';
import type { BlockLayer } from './blocks/types';
import { createEditorHost } from './editorHost';
import { createEditorPool, shownPool } from './pool/pool';
import type { StaticPool } from './pool/pool';
import { blockLaidOut, setGeometrySource } from './seams/geometry';
import { acceptRemoteText, createSyncQueue, shownQueue } from './sync';
import type { FrameContext, SyncQueue } from './sync';
import { clampZoom, fitWidthZoom, zoomPercent } from './viewport/camera';
import { shownFitWidth } from './viewport/shown';
import { createGestureTool } from './viewport/gestures';
import { createRouter } from './viewport/router';
import type { PointerToolDef } from './viewport/router';
import { createViewport, shownViewport } from './viewport/viewport';
import type { PageViewport } from './viewport/viewport';
import type { Point } from './viewport/camera';
import layoutStyles from './layout/layout.module.css';
import { pageView, savePageView } from './runtime';
import { t } from '../../strings/t';

export interface MountedPage {
  readonly page: OpenPage;
  readonly viewport: PageViewport;
  readonly layer: BlockLayer;
  readonly pool: StaticPool;
  readonly sync: SyncQueue;
  readonly cache: MarkdownCache;
  readonly host: EditorHost;
  /** Flushes, closes the page, and removes the view. */
  destroy(): Promise<void>;
}

export interface MountOptions {
  classNames: { viewport: string; world: string; underlay: string };
  host?: Partial<EditorHost>;
  reading?: boolean;
  /** Called when undo or another window changes the title, tags, or view. */
  onPageFields?(fields: NonNullable<AppliedFrame['page']>): void;
  /** Whether the shown page's stores point at this view; tests that mount several pages turn it off. */
  shown?: boolean;
}

function frameContext(pool: StaticPool, layer: () => BlockLayer, options: MountOptions): FrameContext {
  return {
    textState(block) {
      const editor = pool.editor(block);
      const sync = editor && syncOf(editor);
      return editor && sync ? { doc: editor.state.doc, markdown: sync.lastSent() } : null;
    },
    replaceText(block, change, markdown) {
      const editor = pool.editor(block);
      if (!editor || change === 'full' || !('full' in change)) return;
      const doc: PMNode = editor.schema.nodeFromJSON(change.full.toJSON());
      const { tr } = editor.state;
      editor.view.dispatch(tr.replaceWith(0, tr.doc.content.size, doc.content).setMeta(META_REMOTE, true));
      const sync = syncOf(editor);
      if (sync) acceptRemoteText(sync, markdown);
      blockLaidOut(block);
    },
    upsertBlock: (block) => layer().upsert(block),
    removeBlock: (block) => layer().remove(block),
    setPageFields: (fields) => options.onPageFields?.(fields),
    restoreSelection(selection) {
      if (selection.kind !== 'text') return;
      pool.mount(selection.block, { kind: 'selection', anchor: selection.anchor, head: selection.head }, 'target');
      pool.editor(selection.block)?.commands.focus();
    },
    focusedBlock: () => pool.active()?.block ?? null,
  };
}

/** An empty text box for a page with no text yet. It joins page.json with its first change. */
function draftTextBlock(): BlockJson {
  const now = new Date().toISOString();
  const id = newId();
  const block: BlockJson = { id, type: 'text', order: 'zz', created: now, modified: now, data: { markdown: '' } };
  return markDraft(block, { block: { id, type: 'text' } });
}

/** The flow column: every block wrapper, in reading order. Floating blocks inside it sit at their frames. */
function createFlow(viewport: PageViewport): { flow: HTMLElement; stop(): void } {
  const flow = viewport.world.ownerDocument.createElement('div');
  flow.className = layoutStyles.flow;
  viewport.world.append(flow);
  let frame = 0;
  // The world grows in the next frame: growing it from the observer would make the observer loop.
  const observer = new ResizeObserver(() => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      viewport.setContent({ w: flow.offsetLeft + flow.offsetWidth, h: flow.offsetTop + flow.offsetHeight });
    });
  });
  observer.observe(flow);
  return {
    flow,
    stop() {
      observer.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}

/** Puts the page back where it was last shown on this device, and remembers where it is when it settles. */
function followView(page: OpenPage, viewport: PageViewport): () => void {
  const saved = pageView(page.id);
  if (saved) {
    const zoom = clampZoom(saved.zoom);
    const seen = viewport.camera().viewport;
    viewport.zoomAt(zoom, { x: seen.x, y: seen.y }, 'commandZoom');
    // Blocks below the viewport may not have their heights yet, so the world makes room for the saved place first.
    viewport.setContent({ w: (saved.scrollX + seen.w) / zoom, h: (saved.scrollY + seen.h) / zoom });
    viewport.scrollTo(saved.scrollX, saved.scrollY);
  }
  const stopCamera = viewport.onCamera((camera) => {
    if (camera.gesture) return;
    savePageView(page.id, { scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom });
  });
  const stopGesture = viewport.onGesture((phase, kind) => {
    if (phase !== 'end' || (kind !== 'pinch' && kind !== 'wheelZoom')) return;
    announce(t('page.zoom.announce', { percent: zoomPercent(viewport.camera().zoom) }));
  });
  return () => {
    stopCamera();
    stopGesture();
  };
}

/** The zoom that fits the widest content, at least the flow column, to the viewport. */
function fitWidth(viewport: PageViewport, flow: HTMLElement): number {
  let right = flow.offsetLeft + flow.offsetWidth;
  for (const element of flow.children) {
    if (element instanceof HTMLElement) right = Math.max(right, element.offsetLeft + element.offsetWidth);
  }
  return fitWidthZoom(right + flow.offsetLeft, viewport.camera().viewport.w);
}

/** The block under a point in page units: a hit test, so only at pointer down. */
function blockAt(viewport: PageViewport, point: Point): BlockId | null {
  const client = viewport.toClient(point.x, point.y);
  const hit = viewport.viewport.ownerDocument.elementFromPoint(client.x, client.y);
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

export function mountPage(container: HTMLElement, page: OpenPage, options: MountOptions): MountedPage {
  const cache = createMarkdownCache();
  const viewport = createViewport(container, options.classNames);
  const { flow, stop: stopFlow } = createFlow(viewport);
  const pool = createEditorPool();
  const host = createEditorHost(options.host);
  const frames = frameContext(pool, () => layer, options);
  const sync = createSyncQueue({ page, cache, frames, announce });
  const layer = createBlockLayer(flow, {
    page,
    host,
    viewport,
    pool,
    sync,
    cache,
    reading: options.reading ?? false,
  });
  layer.apply(page.initial);
  if (!page.readOnly && !page.initial.blocks.some((block) => block.type === 'text')) layer.upsert(draftTextBlock());
  const stopView = followView(page, viewport);
  const gestures = createGestureTool(viewport);
  const stopRouter = routePointers(viewport, [gestures]);
  const shown = options.shown ?? true;
  if (shown) {
    shownViewport.set(viewport);
    shownFitWidth.set(() => fitWidth(viewport, flow));
    shownQueue.set(sync);
    shownPool.set(pool);
    setGeometrySource((block) => layer.view(block)?.element ?? null);
  }
  const stopExit = beforeExit.register({
    id: `page.flush.${page.client}`,
    order: 10,
    run: () => sync.flushAll('exit').then(() => ({ ok: true }) as const),
  });
  return {
    page,
    viewport,
    layer,
    pool,
    sync,
    cache,
    host,
    async destroy() {
      stopExit();
      await sync.flushAll('pageSwitch').catch(() => undefined);
      stopView();
      stopRouter();
      gestures.destroy();
      stopFlow();
      layer.destroy();
      viewport.destroy();
      if (shown && shownQueue.get() === sync) {
        shownQueue.set(null);
        shownPool.set(null);
        shownViewport.set(null);
        shownFitWidth.set(null);
        setGeometrySource(null);
      }
      await page.close().catch(() => undefined);
    },
  };
}
