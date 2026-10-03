// The image block (Phase 4 ARCHITECTURE.md sections 12.3 to 12.5, owner: WP5). The image sits in a clipping frame
// at the size the asset table gives, so layout never shifts and the page never decodes an image to learn its size.
// The crop is plain layout in percent, so every WebView and print show the same part. A selected image shows its
// handles, a small toolbar, and a "No alt text" badge when it has neither a description nor the decorative mark.
import type { AssetJson, BlockJson, Frame } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { assetTable } from '../images/assets';
import type { AssetTable } from '../images/assets';
import { arrowStep, trackDrag } from '../images/drag';
import type { Crop, Handle, Rect } from '../images/geometry';
import { cropOf, FREEFORM_MAX_WIDTH, HANDLES, heightFor, initialSize, resizeRect } from '../images/geometry';
import { shownImageIds } from '../images/shown';
import styles from '../images/images.module.css';
import { pageSelection, selectOnPage } from '../seams/selectionStore';
import blockStyles from './blocks.module.css';
import type { BlockRenderContext, BlockRendererDef, BlockView } from './types';

/** What the image commands reach through a shown image. */
export interface ImageHandle {
  readonly id: string;
  readonly ctx: BlockRenderContext;
  readonly element: HTMLElement;
  block(): BlockJson;
  asset(): AssetJson | null;
  /** The frame as shown, in page units. */
  rect(): Rect;
  floating(): boolean;
  /** The image element and its frame, for crop mode. */
  parts(): { frame: HTMLElement; picture: HTMLImageElement | null };
  setCropping(on: boolean): void;
}

const shownImages = new Map<string, ImageHandle>();

/** The shown image with this block ID. */
export function imageHandle(id: string): ImageHandle | null {
  return shownImages.get(id) ?? null;
}

/** The one selected image, if exactly one image is selected. */
export function selectedImage(): ImageHandle | null {
  const { blocks, strokes } = pageSelection.get();
  return blocks.length === 1 && strokes.length === 0 ? imageHandle(blocks[0]) : null;
}

const assetOf = (block: BlockJson) => (typeof block.data.asset === 'string' ? block.data.asset : null);
const altOf = (block: BlockJson) => (typeof block.data.alt === 'string' ? block.data.alt : '');
const decorativeOf = (block: BlockJson) => block.data.decorative === true;

/** The accessible name: the description, "Decorative image", or "Image, no description". */
export function imageLabel(block: BlockJson): string {
  if (decorativeOf(block)) return t('images.decorativeLabel');
  const alt = altOf(block).trim();
  return alt ? t('images.label', { alt }) : t('images.unnamed');
}

const isFloating = (frame: Frame | undefined) => frame?.x !== undefined && frame?.y !== undefined;
const px = (value: number) => `${Math.round(value * 100) / 100}px`;

/** The shown size: the frame's, or the asset's at the screen's density for an image that has none yet. */
function shownSize(block: BlockJson, asset: AssetJson | null, crop: Crop | null): { w: number; h: number } {
  const pixels = asset?.width && asset?.height ? { width: asset.width, height: asset.height } : null;
  const fallback = pixels
    ? initialSize(
        { width: pixels.width * (crop?.w ?? 1), height: pixels.height * (crop?.h ?? 1) },
        { dpr: window.devicePixelRatio || 1, maxWidth: FREEFORM_MAX_WIDTH },
      )
    : { w: 240, h: 180 };
  const w = block.frame?.w ?? fallback.w;
  const h = block.frame?.h ?? (pixels ? heightFor(w, pixels, crop) : (w * fallback.h) / fallback.w);
  return { w, h };
}

function layoutPicture(picture: HTMLImageElement, crop: Crop | null): void {
  const whole = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  picture.style.inlineSize = `${100 / whole.w}%`;
  picture.style.blockSize = `${100 / whole.h}%`;
  picture.style.left = `${(-100 * whole.x) / whole.w}%`;
  picture.style.top = `${(-100 * whole.y) / whole.h}%`;
}

class ImageView implements BlockView, ImageHandle {
  readonly element = document.createElement('div');
  readonly editRoot = null;
  readonly id: string;
  private readonly frameElement: HTMLElement;
  private readonly assets: AssetTable;
  private picture: HTMLImageElement | null = null;
  private placeholder: HTMLElement | null = null;
  private failed = false;
  private cropping = false;
  private chrome: HTMLElement[] = [];
  /** Counts refreshes, so a toolbar that loads late never joins a newer one. */
  private chromeGeneration = 0;
  private readonly stops: (() => void)[] = [];

  constructor(
    private current: BlockJson,
    readonly ctx: BlockRenderContext,
  ) {
    this.id = current.id;
    this.assets = assetTable(ctx.page);
    const element = this.element;
    element.className = `${blockStyles.block} ${styles.image}`;
    element.setAttribute('role', 'group');
    element.tabIndex = 0;
    element.dataset.blockId = current.id;
    element.dataset.scope = 'pageObject';
    element.dataset.appMenu = 'page.image';
    this.frameElement = element.appendChild(document.createElement('div'));
    this.frameElement.className = styles.frame;
    element.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    element.addEventListener('dblclick', () => {
      if (this.editable()) void import('../images/cropMode').then(({ startCrop }) => startCrop(this));
    });
    this.stops.push(
      this.assets.onChange((id) => {
        if (id !== assetOf(this.current)) return;
        this.failed = false;
        this.render();
      }),
      pageSelection.subscribe(() => this.refreshChrome()),
    );
    shownImages.set(this.id, this);
    shownImageIds.add(this.id);
    this.render();
  }

  block(): BlockJson {
    return this.current;
  }

  asset(): AssetJson | null {
    const id = assetOf(this.current);
    return id ? this.assets.get(id) : null;
  }

  floating(): boolean {
    return isFloating(this.current.frame);
  }

  parts() {
    return { frame: this.frameElement, picture: this.picture };
  }

  setCropping(on: boolean): void {
    this.cropping = on;
    this.element.classList.toggle(styles.cropping, on);
    this.refreshChrome();
  }

  update(next: BlockJson): void {
    if (next.data.asset !== this.current.data.asset) this.failed = false;
    this.current = next;
    this.render();
  }

  measure() {
    const shown = this.rect();
    return { x: shown.x, y: shown.y, w: this.element.offsetWidth || shown.w, h: this.element.offsetHeight || shown.h };
  }

  rect(): Rect {
    const block = this.current;
    const size = shownSize(block, this.asset(), cropOf(block.data));
    return {
      x: block.frame?.x ?? this.element.offsetLeft,
      y: block.frame?.y ?? this.element.offsetTop,
      w: this.frameElement.offsetWidth || size.w,
      h: this.frameElement.offsetHeight || size.h,
    };
  }

  destroy(): void {
    this.stops.forEach((stop) => stop());
    if (shownImages.get(this.id) === this) {
      shownImages.delete(this.id);
      shownImageIds.delete(this.id);
    }
    this.element.remove();
  }

  private editable(): boolean {
    const { lock } = this.current;
    return !this.ctx.reading && !this.ctx.page.readOnly && lock !== 'all' && lock !== 'position';
  }

  private render(): void {
    const block = this.current;
    const id = assetOf(block);
    const asset = this.asset();
    const crop = cropOf(block.data);
    const floating = this.floating();
    this.element.classList.toggle(blockStyles.floating, floating);
    this.element.style.left = floating ? px(block.frame!.x!) : '';
    this.element.style.top = floating ? px(block.frame!.y!) : '';
    this.showSize(shownSize(block, asset, crop), floating);
    if (asset && id && !this.failed) this.showPicture(asset, id);
    else this.showPlaceholder();
    if (this.picture) layoutPicture(this.picture, crop);
    this.element.setAttribute('aria-label', imageLabel(block));
    this.element.dataset.lock = block.lock ?? '';
    this.refreshChrome();
  }

  /** A flowing image keeps its ratio when the column is narrower than its width. */
  private showSize(size: { w: number; h: number }, floating: boolean): void {
    const style = this.frameElement.style;
    style.inlineSize = px(size.w);
    style.blockSize = floating ? px(size.h) : '';
    style.aspectRatio = floating ? '' : `${size.w} / ${size.h}`;
  }

  private showPlaceholder(): void {
    this.picture?.remove();
    this.picture = null;
    if (!this.placeholder) {
      this.placeholder = this.frameElement.appendChild(document.createElement('div'));
      this.placeholder.className = styles.placeholder;
    }
    const alt = altOf(this.current).trim();
    this.placeholder.textContent = alt ? `${alt} (${t('images.missing')})` : t('images.missing');
  }

  private showPicture(asset: AssetJson, id: string): void {
    this.placeholder?.remove();
    this.placeholder = null;
    const src = this.ctx.page.assetUrl(id);
    if (!this.picture) {
      const picture = this.frameElement.appendChild(document.createElement('img'));
      picture.className = styles.picture;
      picture.decoding = 'async';
      picture.loading = 'lazy';
      picture.draggable = false;
      picture.addEventListener('error', () => {
        this.failed = true;
        this.showPlaceholder();
      });
      this.picture = picture;
    }
    if (this.picture.getAttribute('src') !== src) this.picture.src = src;
    if (asset.width) this.picture.width = asset.width;
    if (asset.height) this.picture.height = asset.height;
    this.picture.alt = decorativeOf(this.current) ? '' : altOf(this.current);
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.cropping || event.button !== 0) return;
    const { blocks } = pageSelection.get();
    const extend = event.shiftKey || event.ctrlKey;
    if (!blocks.includes(this.id) || extend) {
      selectOnPage({ blocks: extend ? [...new Set([...blocks, this.id])] : [this.id], strokes: [] });
    }
    this.element.focus({ preventScroll: true });
  }

  private sendFrame(next: Rect): void {
    const block = this.current;
    const rotate = block.frame?.rotate ? { rotate: block.frame.rotate } : {};
    const frame: Frame = this.floating() ? { x: next.x, y: next.y, w: next.w, h: next.h, ...rotate } : { w: next.w };
    this.current = { ...block, frame };
    this.render();
    void this.ctx.sync
      .send({ edits: [{ edit: 'moveBlock', block: this.id, frame }], coalesce: { kind: 'resize', target: this.id } })
      .catch(() => undefined);
  }

  private startResize(event: PointerEvent, handle: Handle): void {
    const start = this.rect();
    const floating = this.floating();
    let next = start;
    trackDrag(
      event,
      this.ctx.viewport.camera().zoom || 1,
      (dx, dy, moveEvent) => {
        next = resizeRect(start, handle, dx, dy, moveEvent.shiftKey);
        this.showSize(next, floating);
        if (!floating) return;
        this.element.style.left = px(next.x);
        this.element.style.top = px(next.y);
      },
      () => next !== start && this.sendFrame(next),
    );
  }

  private resizeByKey(event: KeyboardEvent, handle: Handle): void {
    const step = arrowStep(event, event.shiftKey ? 1 : 10);
    if (step) this.sendFrame(resizeRect(this.rect(), handle, step[0], step[1]));
  }

  private refreshChrome(): void {
    this.chrome.forEach((part) => part.remove());
    this.chrome = [];
    const generation = ++this.chromeGeneration;
    const selected = selectedImage()?.id === this.id;
    this.element.classList.toggle(styles.selected, selected);
    if (!selected || this.cropping) return;
    if (!altOf(this.current).trim() && !decorativeOf(this.current)) {
      const badge = this.frameElement.appendChild(document.createElement('span'));
      badge.className = styles.badge;
      badge.textContent = t('images.noAltBadge');
      badge.setAttribute('aria-hidden', 'true');
      this.chrome.push(badge);
    }
    if (!this.editable()) return;
    this.addHandles();
    void import('../images/toolbar').then(({ imageToolbar }) => {
      if (generation !== this.chromeGeneration || !this.element.isConnected) return;
      const bar = imageToolbar(this);
      this.element.append(bar);
      this.chrome.push(bar);
    });
  }

  /** A flowing image has one corner handle and stores only its width. */
  private addHandles(): void {
    const handles = this.floating() ? HANDLES : (['se'] as const);
    for (const handle of handles) {
      const button = this.element.appendChild(document.createElement('button'));
      button.type = 'button';
      button.className = `${styles.handle} ${styles[handle]}`;
      button.tabIndex = -1;
      button.setAttribute('aria-label', t('images.resizeHandle', { edge: t(`images.edges.${handle}`) }));
      button.addEventListener('pointerdown', (event) => this.startResize(event, handle));
      button.addEventListener('keydown', (event) => this.resizeByKey(event, handle));
      this.chrome.push(button);
    }
  }
}

export const imageBlockRenderer: BlockRendererDef = {
  id: 'image',
  types: ['image'],
  priority: 0,
  flag: 'page.images',
  create: (block, ctx) => new ImageView(block, ctx),
};
