// The small toolbar over a selected image: Crop, Alt text, and the one-click switch between "Actual size" and
// "Fit to column" (FEATURES.md, Screenshot paste size). Arrow keys move between its buttons.
import { isEnabled } from '../../../app/flags';
import { executeCommand } from '../../../commands/registry';
import { t } from '../../../strings/t';
import type { ImageHandle } from '../blocks/imageBlock';
import { cropOf, FREEFORM_MAX_WIDTH, heightFor, initialSize } from './geometry';
import styles from './images.module.css';
import { canWrap, openWrapMenu } from './wrapMenu';

/** The column a flowing image fits: the world's width, or the freeform cap when that isn't known. */
export function columnWidth(handle: ImageHandle): number {
  const world = handle.ctx.viewport.world;
  const style = world.isConnected ? getComputedStyle(world) : null;
  const padding = style ? parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0') : 0;
  const width = world.clientWidth - padding;
  return handle.floating() || width <= 0 ? FREEFORM_MAX_WIDTH : width;
}

/** The image's width at its own pixels on this screen, for the shown part. */
export function actualWidth(handle: ImageHandle): number | null {
  const asset = handle.asset();
  if (!asset?.width || !asset.height) return null;
  const crop = cropOf(handle.block().data);
  return initialSize(
    { width: asset.width * (crop?.w ?? 1), height: asset.height * (crop?.h ?? 1) },
    { dpr: window.devicePixelRatio || 1, maxWidth: Number.POSITIVE_INFINITY },
  ).w;
}

/** Sets an image's width, keeping the shown part's aspect ratio. */
export function setImageWidth(handle: ImageHandle, width: number): Promise<unknown> {
  const block = handle.block();
  const asset = handle.asset();
  const rect = handle.rect();
  const crop = cropOf(block.data);
  const height =
    asset?.width && asset.height ? heightFor(width, { width: asset.width, height: asset.height }, crop) : rect.h;
  const frame = handle.floating() ? { ...block.frame, w: width, h: height } : { w: width };
  return handle.ctx.sync.send({ edits: [{ edit: 'moveBlock', block: block.id, frame }] }).catch(() => undefined);
}

export function imageToolbar(handle: ImageHandle): HTMLElement {
  const bar = document.createElement('div');
  bar.className = styles.toolbar;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', t('images.toolbar'));
  bar.addEventListener('pointerdown', (event) => event.stopPropagation());
  const button = (label: string, run: () => void) => {
    const element = bar.appendChild(document.createElement('button'));
    element.type = 'button';
    element.textContent = label;
    element.tabIndex = bar.childElementCount === 1 ? 0 : -1;
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      run();
    });
    return element;
  };
  button(t('images.crop'), () => void import('./cropMode').then(({ startCrop }) => startCrop(handle)));
  button(t('images.altText'), () => void import('./AltTextDialog').then(({ editAltText }) => editAltText(handle)));
  if (canWrap(handle)) {
    const wrapButton = button(t('pageExtras.wrap.menu'), () => void openWrapMenu(handle, wrapButton));
    wrapButton.setAttribute('aria-haspopup', 'menu');
  }
  // Phase 12: reads the words in the image on this device, and offers to turn text recognition on first.
  if (isEnabled('intel.ocr')) {
    button(t('intel.commands.copyImageTextShort'), () => void executeCommand('intel.copyImageText', undefined, 'menu'));
  }
  const actual = actualWidth(handle);
  if (actual !== null) {
    const column = columnWidth(handle);
    const atActual = Math.abs(handle.rect().w - actual) < 1;
    if (!atActual) button(t('images.actualSize'), () => void setImageWidth(handle, actual));
    else if (actual > column) button(t('images.fitColumn'), () => void setImageWidth(handle, column));
  }
  bar.addEventListener('keydown', (event) => {
    const items = [...bar.querySelectorAll('button')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: items.length - 1 - index }[event.key];
    if (step === undefined || index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next = items[(index + step + items.length) % items.length];
    items.forEach((item) => (item.tabIndex = item === next ? 0 : -1));
    next.focus();
  });
  return bar;
}
