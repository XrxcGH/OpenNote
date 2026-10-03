// Crop mode (Phase 4 ARCHITECTURE.md section 12.4): the whole image shows dimmed with the crop rectangle bright and
// 8 crop handles. Enter or a click outside keeps the crop as one batch: a patchBlock with data.crop, and a
// moveBlock so the image keeps its scale. Escape cancels. Each handle moves by the arrow keys too, 1% a press.
import type { Edit, Frame } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import type { ImageHandle } from '../blocks/imageBlock';
import type { Crop, Handle } from './geometry';
import { cropDrag, cropOf, frameForCrop, HANDLES, isWhole } from './geometry';
import { arrowStep, trackDrag } from './drag';
import styles from './images.module.css';

/** The edits that change an image's crop and keep its scale, or none when nothing changed. */
export function cropEdits(handle: ImageHandle, next: Crop | null): Edit[] {
  const block = handle.block();
  const before = cropOf(block.data);
  const after = next && !isWhole(next) ? next : null;
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const moved = frameForCrop(handle.rect(), before, after);
  const frame: Frame = handle.floating()
    ? { x: moved.x, y: moved.y, w: moved.w, h: moved.h, ...(block.frame?.rotate ? { rotate: block.frame.rotate } : {}) }
    : { w: moved.w };
  return [
    { edit: 'patchBlock', block: block.id, data: { crop: after } },
    { edit: 'moveBlock', block: block.id, frame },
  ];
}

/** Sends a crop change, if any, as one undo step. */
export function applyCrop(handle: ImageHandle, next: Crop | null): Promise<boolean> {
  const edits = cropEdits(handle, next);
  if (edits.length === 0) return Promise.resolve(false);
  return handle.ctx.sync.send({ edits }).then(
    () => true,
    () => false,
  );
}

let active: CropSession | null = null;

/** The crop being edited: the whole image dimmed, the crop window bright, and its handles. */
class CropSession {
  private current: Crop;
  private readonly region = document.createElement('div');
  private readonly bright: HTMLImageElement;
  /** The whole image, in the frame's coordinates. */
  private readonly whole: { x: number; y: number; w: number; h: number };
  private readonly zoom: number;
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.finish(event.key === 'Enter');
  };
  private readonly onOutside = (event: PointerEvent) => {
    if (!this.handle.element.contains(event.target as Node)) this.finish(true);
  };

  constructor(
    readonly handle: ImageHandle,
    frame: HTMLElement,
    picture: HTMLImageElement,
  ) {
    const start = cropOf(handle.block().data) ?? { x: 0, y: 0, w: 1, h: 1 };
    const shown = handle.rect();
    const w = shown.w / start.w;
    const h = shown.h / start.h;
    this.whole = { x: -start.x * w, y: -start.y * h, w, h };
    this.current = { ...start };
    this.zoom = handle.ctx.viewport.camera().zoom || 1;
    this.region.className = styles.cropWindow;
    this.region.setAttribute('role', 'group');
    this.region.setAttribute('aria-label', t('images.cropMode.label'));
    this.bright = this.region.appendChild(picture.cloneNode() as HTMLImageElement);
    this.bright.alt = '';
    frame.append(this.region);
    const buttons = HANDLES.map((edge) => this.addHandle(edge));
    handle.element.addEventListener('keydown', this.onKey, true);
    document.addEventListener('pointerdown', this.onOutside, true);
    this.layout();
    buttons[0].focus({ preventScroll: true });
  }

  private addHandle(edge: Handle): HTMLButtonElement {
    const button = this.region.appendChild(document.createElement('button'));
    button.type = 'button';
    button.className = `${styles.handle} ${styles[edge]}`;
    button.setAttribute('aria-label', t('images.cropMode.handle', { edge: t(`images.edges.${edge}`) }));
    button.addEventListener('pointerdown', (event) => {
      const from = this.current;
      const move = (dx: number, dy: number) => this.set(cropDrag(from, edge, dx / this.whole.w, dy / this.whole.h));
      trackDrag(event, this.zoom, move, () => undefined);
    });
    button.addEventListener('keydown', (event) => {
      const step = arrowStep(event, event.shiftKey ? 0.001 : 0.01);
      if (step) this.set(cropDrag(this.current, edge, step[0], step[1]));
    });
    return button;
  }

  private set(next: Crop): void {
    this.current = next;
    this.layout();
  }

  private layout(): void {
    const { whole, current } = this;
    Object.assign(this.region.style, {
      left: `${whole.x + current.x * whole.w}px`,
      top: `${whole.y + current.y * whole.h}px`,
      inlineSize: `${current.w * whole.w}px`,
      blockSize: `${current.h * whole.h}px`,
    });
    Object.assign(this.bright.style, {
      left: `${-current.x * whole.w}px`,
      top: `${-current.y * whole.h}px`,
      inlineSize: `${whole.w}px`,
      blockSize: `${whole.h}px`,
    });
  }

  finish(keep: boolean): void {
    if (active !== this) return;
    active = null;
    this.handle.element.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.region.remove();
    this.handle.setCropping(false);
    this.handle.element.focus({ preventScroll: true });
    if (!keep) return announce(t('images.cropMode.cancelled'));
    void applyCrop(this.handle, this.current).then((changed) => changed && announce(t('images.cropMode.applied')));
  }
}

/** Whether an image is in crop mode now. */
export function cropping(): ImageHandle | null {
  return active?.handle ?? null;
}

/** Ends crop mode. With `keep`, the change stays. */
export function endCrop(keep: boolean): void {
  active?.finish(keep);
}

/** Starts crop mode on an image, ending crop mode on any other first. */
export function startCrop(handle: ImageHandle): void {
  if (active?.handle === handle) return;
  active?.finish(true);
  const { frame, picture } = handle.parts();
  if (!picture) return;
  handle.setCropping(true);
  active = new CropSession(handle, frame, picture);
}
