// The attachment block: a card with the file's type,
// name, and size, shown as an icon or, for plain text, with its first lines. Opening it hands a copy to the file's own
// app, and the shell saves each change that app makes back into the page's assets (attachments/saveBack.ts). The block
// is selected like an image, moves like any object, and opens with Enter, a double click, or its Open button.
import { commandContext } from '../../../commands/registry';
import type { AssetJson, BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { fileKind, formatSize, isTextual, previewLines } from '../attachments/model';
import styles from '../attachments/attachments.module.css';
import { assetTable } from '../images/assets';
import { readingLock } from '../qol/stores';
import { pageSelection, selectOnPage } from '../seams/selectionStore';
import blockStyles from './blocks.module.css';
import { placeBlock } from './textBlock';
import type { BlockRenderContext, BlockRendererDef, BlockView } from './types';

const assetOf = (block: BlockJson) => (typeof block.data.asset === 'string' ? block.data.asset : null);
const displayOf = (block: BlockJson): 'icon' | 'preview' => (block.data.display === 'preview' ? 'preview' : 'icon');

/** How long "Saved" stays under a card after its app saved a change. */
const SAVED_MS = 8000;

/** What Open said when it failed, in words. */
export function openFailure(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
  if (code === 'blockedType') return t('pageExtras.attach.blocked');
  if (code === 'noApp') return t('pageExtras.attach.noApp');
  if (code === 'notImplemented') return t('pageExtras.attach.desktopOnly');
  return t('pageExtras.attach.openFailed');
}

class FileView implements BlockView {
  readonly element = document.createElement('div');
  readonly editRoot = null;
  private readonly card = document.createElement('div');
  private readonly status = document.createElement('span');
  private preview: HTMLElement | null = null;
  private previewFor = '';
  private timer = 0;
  private destroyed = false;
  private readonly stops: (() => void)[] = [];

  constructor(
    private current: BlockJson,
    private readonly ctx: BlockRenderContext,
  ) {
    const element = this.element;
    element.className = `${blockStyles.block} ${styles.file}`;
    element.setAttribute('role', 'group');
    element.tabIndex = 0;
    element.dataset.blockId = current.id;
    element.dataset.scope = 'pageObject';
    element.dataset.appMenu = 'page.attachment';
    this.card.className = styles.card;
    this.status.className = styles.status;
    this.status.setAttribute('role', 'status');
    element.append(this.card, this.status);
    element.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    element.addEventListener('dblclick', () => void this.open());
    element.addEventListener('keydown', (event) => {
      if (event.target === element && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        void this.open();
      }
    });
    this.stops.push(
      assetTable(ctx.page).onChange((id) => id === assetOf(this.current) && this.render()),
      pageSelection.subscribe(() => this.element.classList.toggle(styles.selected, this.selected())),
    );
    placeBlock(element, current);
    this.render();
  }

  update(next: BlockJson): void {
    const changed = assetOf(next) !== assetOf(this.current);
    this.current = next;
    placeBlock(this.element, next);
    this.render();
    if (changed) this.flashSaved();
  }

  measure() {
    const { element } = this;
    return { x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight };
  }

  destroy(): void {
    this.destroyed = true;
    window.clearTimeout(this.timer);
    this.stops.forEach((stop) => stop());
    this.element.remove();
  }

  private selected(): boolean {
    return pageSelection.get().blocks.includes(this.current.id);
  }

  private asset(): AssetJson | null {
    const id = assetOf(this.current);
    return id ? assetTable(this.ctx.page).get(id) : null;
  }

  private render(): void {
    const asset = this.asset();
    const name = asset?.name ?? '';
    const kind = fileKind(name);
    const label = document.createElement('span');
    label.className = styles.badge;
    label.dataset.family = kind.family;
    label.textContent = kind.label;
    label.setAttribute('aria-hidden', 'true');
    const meta = document.createElement('span');
    meta.className = styles.meta;
    const title = meta.appendChild(document.createElement('span'));
    title.className = styles.name;
    title.textContent = asset ? name : t('pageExtras.attach.missing');
    if (asset) {
      const size = meta.appendChild(document.createElement('span'));
      size.className = styles.size;
      size.textContent = formatSize(asset.bytes);
    }
    const open = document.createElement('button');
    open.type = 'button';
    open.className = styles.open;
    open.textContent = t('pageExtras.attach.open');
    open.disabled = !asset;
    open.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.open();
    });
    this.card.replaceChildren(label, meta, open);
    this.element.setAttribute(
      'aria-label',
      asset ? t('pageExtras.attach.label', { name, size: formatSize(asset.bytes) }) : t('pageExtras.attach.missing'),
    );
    this.element.classList.toggle(styles.selected, this.selected());
    void this.showPreview(asset);
  }

  /** The first lines of a text file, when the card is set to preview. */
  private async showPreview(asset: AssetJson | null): Promise<void> {
    const wanted = asset && displayOf(this.current) === 'preview' && isTextual(asset.name, asset.mime);
    if (!wanted) {
      this.preview?.remove();
      this.preview = null;
      this.previewFor = '';
      return;
    }
    const key = `${assetOf(this.current)}`;
    if (this.previewFor === key) return;
    this.previewFor = key;
    try {
      const response = await fetch(this.ctx.page.assetUrl(key), { headers: { Range: 'bytes=0-4095' } });
      const text = previewLines(await response.text());
      if (this.destroyed || this.previewFor !== key) return;
      this.preview ??= this.element.insertBefore(document.createElement('pre'), this.status);
      this.preview.className = styles.preview;
      this.preview.textContent = text;
    } catch {
      this.preview?.remove();
      this.preview = null;
    }
  }

  private flashSaved(): void {
    this.status.textContent = t('pageExtras.attach.saved');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => (this.status.textContent = ''), SAVED_MS);
  }

  /** Opens the file in its own app and starts saving its changes back. */
  async open(): Promise<void> {
    const asset = this.asset();
    const id = assetOf(this.current);
    if (!asset || !id) return;
    try {
      await commandContext('menu').platform.pageExtras.openAttachment(this.ctx.page.id, id, asset.name);
      showToast({ message: t('pageExtras.attach.opened', { name: asset.name }) });
    } catch (error) {
      showToast({ message: openFailure(error), tone: 'danger' });
    }
  }

  /** Shows the card as an icon or with a preview, as one undo step. */
  setDisplay(display: 'icon' | 'preview'): void {
    if (this.ctx.page.readOnly || readingLock.get()) return;
    this.current = { ...this.current, data: { ...this.current.data, display } };
    this.previewFor = '';
    this.render();
    void this.ctx.sync
      .send({
        edits: [{ edit: 'patchBlock', block: this.current.id, data: { display: display === 'icon' ? null : display } }],
      })
      .catch(() => undefined);
  }

  display(): 'icon' | 'preview' {
    return displayOf(this.current);
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const { blocks } = pageSelection.get();
    const extend = event.shiftKey || event.ctrlKey;
    if (!blocks.includes(this.current.id) || extend) {
      selectOnPage({ blocks: extend ? [...new Set([...blocks, this.current.id])] : [this.current.id], strokes: [] });
    }
    this.element.focus({ preventScroll: true });
  }
}

/** The attachment views on screen, for the commands that act on the selected one. */
export function fileView(view: BlockView | null): FileView | null {
  return view instanceof FileView ? view : null;
}

export const fileBlockRenderer: BlockRendererDef = {
  id: 'file',
  types: ['file'],
  priority: 0,
  flag: 'page.attachments',
  create: (block, ctx) => new FileView(block, ctx),
};
