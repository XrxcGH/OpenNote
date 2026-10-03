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
import type { AppliedFrame, BlockJson, OpenPage } from '../../services/pages/types';
import { announce } from '../../ui';
import { createBlockLayer } from './blocks/blockLayer';
import { markDraft, syncOf } from './blocks/textBlock';
import type { BlockLayer } from './blocks/types';
import { createEditorHost } from './editorHost';
import { attachPageMedia } from './images/attach';
import { createEditorPool, shownPool } from './pool/pool';
import type { StaticPool } from './pool/pool';
import { blockLaidOut, setGeometrySource } from './seams/geometry';
import { acceptRemoteText, createSyncQueue, shownQueue } from './sync';
import type { FrameContext, SyncQueue } from './sync';
import { createViewport, shownViewport } from './viewport/viewport';
import type { PageViewportApi } from './viewport/viewport';

export interface MountedPage {
  readonly page: OpenPage;
  readonly viewport: PageViewportApi;
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

export function mountPage(container: HTMLElement, page: OpenPage, options: MountOptions): MountedPage {
  const cache = createMarkdownCache();
  const viewport = createViewport(container, options.classNames);
  const pool = createEditorPool();
  const host = createEditorHost(options.host);
  const frames = frameContext(pool, () => layer, options);
  const sync = createSyncQueue({ page, cache, frames, announce });
  const layer = createBlockLayer(viewport.world, {
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
  const shown = options.shown ?? true;
  if (shown) {
    shownViewport.set(viewport);
    shownQueue.set(sync);
    shownPool.set(pool);
    setGeometrySource((block) => layer.view(block)?.element ?? null);
  }
  const stopExit = beforeExit.register({
    id: `page.flush.${page.client}`,
    order: 10,
    run: () => sync.flushAll('exit').then(() => ({ ok: true }) as const),
  });
  const mounted: MountedPage = {
    page,
    viewport,
    layer,
    pool,
    sync,
    cache,
    host,
    async destroy() {
      stopExit();
      detachMedia();
      await sync.flushAll('pageSwitch').catch(() => undefined);
      layer.destroy();
      viewport.destroy();
      if (shown && shownQueue.get() === sync) {
        shownQueue.set(null);
        shownPool.set(null);
        shownViewport.set(null);
        setGeometrySource(null);
      }
      await page.close().catch(() => undefined);
    },
  };
  const detachMedia = attachPageMedia(mounted, container, shown);
  return mounted;
}
