// The card under an embed line: a header with the target's current title and a button that opens it, and the target's
// text boxes as live editors. The card opens the target page on its own (a second window onto the page, as another
// window of the app would be), with its own editors and sync queue, so typing here saves to the target page and typing
// there shows up here. Embeds inside an embedded page are left as text, so two pages that embed each other can't loop.
import { commandContext } from '../../../commands/registry';
import { createMarkdownCache } from '../../../editor/markdown';
import type { EditorHost } from '../../../editor/host';
import type { NodeId } from '../../../services/notes/types';
import type { BlockJson, OpenPage, PageId } from '../../../services/pages/types';
import { beforeExit } from '../../../registries';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import type { BlockLayer, BlockRenderContext, BlockView } from '../blocks/types';
import { frameContext } from '../blocks/frameContext';
import { textBlockRenderer } from '../blocks/textBlock';
import type { LazyBlockView } from '../blocks/textBlock';
import { createEditorHost } from '../editorHost';
import { shownMounted } from '../pagesApi';
import { createEditorPool } from '../pool/pool';
import { byOrder } from '../readingOrder/order';
import { pagesClient } from '../runtime';
import { createSyncQueue, exitHook } from '../sync';
import type { SyncQueue } from '../sync';
import type { PageViewportApi } from '../viewport/viewport';
import styles from '../qol/qol.module.css';
import { pickBlocks } from './model';
import type { EmbedRef } from './model';

const markdownOf = (block: BlockJson) => (typeof block.data.markdown === 'string' ? block.data.markdown : '');

/** Opens a page in the app, from its ID. */
async function openInApp(pageId: string): Promise<void> {
  const { notes, navigate } = commandContext('palette');
  const page = await notes.get(pageId as NodeId);
  if (!page?.parentId) return;
  let notebook = await notes.get(page.parentId);
  while (notebook?.parentId) notebook = await notes.get(notebook.parentId);
  if (!notebook) return;
  navigate(
    { view: 'workspace', notebookId: notebook.id, sectionId: page.parentId, pageId: page.id },
    { focus: 'target' },
  );
}

export class EmbedCard {
  readonly element = document.createElement('div');
  private readonly header = document.createElement('div');
  private readonly body = document.createElement('div');
  private destroyed = false;
  private open: OpenPage | null = null;
  private sync: SyncQueue | null = null;
  private stops: (() => void)[] = [];
  private views = new Map<string, BlockView>();

  constructor(private readonly ref: EmbedRef) {
    this.element.className = styles.embed;
    this.element.contentEditable = 'false';
    this.element.setAttribute('role', 'group');
    this.header.className = styles.embedHeader;
    this.body.className = styles.embedBody;
    this.element.append(this.header, this.body);
    this.say(t('pageExtras.embed.loading'));
    void this.start().catch(() => this.say(t('pageExtras.embed.failed')));
  }

  destroy(): void {
    this.destroyed = true;
    void this.close();
  }

  private say(message: string): void {
    this.header.replaceChildren(message);
    this.element.setAttribute('aria-label', message);
  }

  private async close(): Promise<void> {
    this.stops.reverse().forEach((stop) => stop());
    this.stops = [];
    this.views.forEach((view) => view.destroy());
    this.views.clear();
    await this.sync?.flushAll('unmount').catch(() => undefined);
    await this.open?.close().catch(() => undefined);
    this.open = null;
  }

  private showHeader(title: string, page: string, note: string | null): void {
    const label = document.createElement('span');
    label.className = styles.embedTitle;
    label.textContent = this.ref.heading ? `${title} › ${this.ref.heading}` : title;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = styles.embedOpen;
    open.textContent = t('pageExtras.embed.open');
    open.addEventListener('click', () => void openInApp(page));
    this.header.replaceChildren(
      label,
      ...(note ? [Object.assign(document.createElement('span'), { textContent: note })] : []),
      open,
    );
    this.element.setAttribute('aria-label', t('pageExtras.embed.label', { title }));
  }

  private async start(): Promise<void> {
    const from = shownMounted.get()?.page.id;
    const { platform } = commandContext('menu');
    const [resolution] = await platform.search.resolve(
      [{ title: this.ref.title, ...(this.ref.heading ? { heading: this.ref.heading } : {}) }],
      from,
    );
    const target = resolution?.targets[0];
    if (this.destroyed) return;
    if (!target) return this.say(t('pageExtras.embed.missing', { title: this.ref.title }));
    if (target.page === from) return this.say(t('pageExtras.embed.self'));
    const open = await pagesClient().open(target.page as PageId, { viewport: null });
    if (this.destroyed) return void (await open.close().catch(() => undefined));
    this.open = open;
    const note =
      resolution.targets.length > 1
        ? t('pageExtras.embed.ambiguous')
        : resolution.headingMissing
          ? t('pageExtras.embed.headingMissing')
          : null;
    this.showHeader(target.title || this.ref.title, target.page, note);
    this.mountBlocks(open);
  }

  /** The target's text boxes, as the page would draw them, with editors mounted so they can be typed in at once. */
  private mountBlocks(open: OpenPage): void {
    const cache = createMarkdownCache();
    const pool = createEditorPool();
    const layer: Partial<BlockLayer> = {
      upsert: (block) => this.views.get(block.id)?.update(block),
      reorder: () => undefined,
      remove: (id) => {
        this.views.get(id)?.destroy();
        this.views.delete(id);
      },
      view: (id) => this.views.get(id) ?? null,
    };
    const frames = frameContext(pool, () => layer as BlockLayer, {
      setPageFields: () => undefined,
      selectObjects: () => undefined,
    });
    const sync = createSyncQueue({ page: open, cache, frames, announce });
    this.sync = sync;
    const base = createEditorHost();
    const host: EditorHost = { ...base, flag: (id) => id !== 'page.embeds' && base.flag(id) };
    const ctx: BlockRenderContext = {
      page: open,
      host,
      viewport: {} as PageViewportApi,
      pool,
      sync,
      cache,
      reading: false,
    };
    const blocks = [...open.initial.blocks].sort(byOrder);
    const shown = new Set(
      pickBlocks(
        blocks.map((block) => ({ id: block.id, type: block.type, markdown: markdownOf(block) })),
        this.ref.heading,
      ),
    );
    for (const block of blocks) {
      if (!shown.has(block.id)) continue;
      const view = textBlockRenderer.create(block, ctx) as LazyBlockView;
      this.views.set(block.id, view);
      this.body.append(view.element);
      view.render();
      if (!open.readOnly) pool.mount(block.id, null, 'target');
    }
    if (this.views.size === 0) this.body.textContent = t('pageExtras.embed.empty');
    this.stops.push(beforeExit.register({ id: `embed.flush.${open.client}`, order: 10, run: exitHook(sync) }), () =>
      pool.destroy(),
    );
  }
}
