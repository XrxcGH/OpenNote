// Getting images onto the page (Phase 4 ARCHITECTURE.md sections 12.1, 12.2, and 6.1): each image goes through the
// page's import queue, and one batch adds the assets and inserts the image blocks. On a freeform page they float
// just below the current text box, or at the drop point; on a flow page they flow after the current block.
import { newId } from '../../../editor/ids';
import type { BlockId, Edit, Frame, ImportedAsset, NewBlock, OpenPage, PageRect } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import type { MountedPage } from '../mount';
import { pageSelection, selectOnPage } from '../seams/selectionStore';
import { assetTable } from './assets';
import { offerActualSize, sizeFor, sizingFor } from '../qol/pasteSize';
import type { Sizing } from '../qol/pasteSize';
import { FREEFORM_MAX_WIDTH } from './geometry';
import styles from './images.module.css';
import type { ImportQueue, QueuedImage } from './importQueue';
import { createImportQueue } from './importQueue';

/** The types WebView2 shows (section 12.2); the shell checks each file's header too. */
export const IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/svg+xml',
] as const;
/** What the shell can convert when page.heicImport is on. */
export const CONVERTIBLE_TYPES = ['image/heic', 'image/heif', 'image/tiff'] as const;
const KEEP_BELOW = 24;
const PROGRESS_DELAY = 300;

export type Placement = { kind: 'point'; x: number; y: number } | { kind: 'after'; block: BlockId | null };

const queues = new WeakMap<OpenPage, ImportQueue>();

/** The quiet progress bar: it appears after 300 ms with "Adding 12 images" and goes when the queue is empty. */
function progressFor(host: () => HTMLElement | null): (state: { pending: number }) => void {
  let element: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let total = 0;
  const render = (pending: number) => {
    if (!element) return;
    const bar = element.querySelector('progress')!;
    const label = t('images.adding', { count: total });
    element.firstChild!.textContent = label;
    bar.max = total;
    bar.value = total - pending;
    bar.setAttribute('aria-label', label);
  };
  return ({ pending }) => {
    if (pending === 0) {
      if (timer) clearTimeout(timer);
      timer = null;
      element?.remove();
      element = null;
      total = 0;
      return;
    }
    total = Math.max(total, pending);
    if (element) return render(pending);
    timer ??= setTimeout(() => {
      timer = null;
      const parent = host();
      if (!parent) return;
      element = parent.appendChild(document.createElement('div'));
      element.className = styles.progress;
      element.append(document.createElement('span'), document.createElement('progress'));
      render(pending);
    }, PROGRESS_DELAY);
  };
}

/** The page's import queue, with its progress bar in the page view. */
export function importsFor(mounted: Pick<MountedPage, 'page' | 'viewport'>): ImportQueue {
  const found = queues.get(mounted.page);
  if (found) return found;
  const progress = progressFor(() => mounted.viewport.viewport.parentElement);
  const queue = createImportQueue({
    run: (source, signal) => mounted.page.importImage(source, signal),
    onChange: progress,
  });
  queues.set(mounted.page, queue);
  return queue;
}

/** The message for an import that failed, from the shell's error codes. */
export function importError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'tooLarge') return t('images.tooLarge');
  if (code === 'unsupportedType') return t('images.unsupported');
  return t('images.failed', { count: 1 });
}

/** The block a new image goes after or below: the focused text box, else the one selected block. */
export function currentBlock(mounted: Pick<MountedPage, 'pool'>): BlockId | null {
  const active = mounted.pool.active()?.block;
  if (active) return active;
  const selected = pageSelection.get().blocks;
  return selected.length > 0 ? selected[selected.length - 1] : null;
}

/** Where a new image goes when nothing names a point. */
export function defaultPlacement(mounted: MountedPage): Placement {
  const current = currentBlock(mounted);
  if (isFlow(mounted.page)) return { kind: 'after', block: current };
  const below = current ? mounted.layer.view(current)?.measure() : null;
  if (below) return { kind: 'point', x: below.x, y: below.y + below.h + KEEP_BELOW };
  const box = mounted.viewport.viewport.getBoundingClientRect();
  const corner = mounted.viewport.toWorld(box.left + 48, box.top + 48);
  return { kind: 'point', x: Math.max(0, corner.x), y: Math.max(0, corner.y, belowTitle(mounted)) };
}

/** The first world y under the title band, so a new block never covers the page title. */
function belowTitle(mounted: Pick<MountedPage, 'title' | 'viewport'>): number {
  const band = mounted.title?.element.getBoundingClientRect();
  if (!band || band.height === 0) return 0;
  return mounted.viewport.toWorld(band.left, band.bottom).y + KEEP_BELOW;
}

export function isFlow(page: OpenPage): boolean {
  return page.initial.view?.layout === 'flow';
}

function flowWidth(mounted: Pick<MountedPage, 'viewport' | 'page'>): number {
  const width = mounted.viewport.world.clientWidth;
  const content = mounted.page.initial.view?.contentWidth;
  return width > 0 ? width : typeof content === 'number' && content > 0 ? content : FREEFORM_MAX_WIDTH;
}

/** The image blocks for imported assets, and where each goes. */
export function imageEdits(
  mounted: Pick<MountedPage, 'viewport' | 'page'>,
  imported: readonly { asset: ImportedAsset; alt?: string }[],
  place: Placement,
  sizing: Sizing = 'fit',
): { edits: Edit[]; blocks: BlockId[] } {
  const edits: Edit[] = [];
  const blocks: BlockId[] = [];
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const floating = place.kind === 'point';
  const maxWidth = floating ? FREEFORM_MAX_WIDTH : flowWidth(mounted);
  let y = floating ? place.y : 0;
  let after = place.kind === 'after' ? place.block : null;
  for (const { asset, alt } of imported) {
    const size = sizeFor(
      { width: asset.asset.width ?? 320, height: asset.asset.height ?? 240 },
      { dpr, maxWidth, sizing },
    );
    const id = newId();
    const frame: Frame = floating ? { x: place.x, y, w: size.w, h: size.h } : { w: size.w };
    const block: NewBlock = { id, type: 'image', frame, data: { asset: asset.id, ...(alt ? { alt } : {}) } };
    edits.push({ edit: 'addAsset', asset: asset.id });
    edits.push(after ? { edit: 'insertBlock', block, after } : { edit: 'insertBlock', block });
    blocks.push(id);
    y += size.h + KEEP_BELOW / 2;
    if (!floating) after = id;
  }
  return { edits, blocks };
}

/** Imports images and inserts them as one undo step. Resolves the new blocks. */
export async function insertImages(
  mounted: MountedPage,
  items: readonly (QueuedImage & { alt?: string })[],
  place: Placement = defaultPlacement(mounted),
  choice: 'actual' | 'fit' | 'ask' = 'fit',
): Promise<BlockId[]> {
  if (items.length === 0) return [];
  const queue = importsFor(mounted);
  const results = await Promise.allSettled(items.map((item) => queue.add(item)));
  const imported: { asset: ImportedAsset; alt?: string }[] = [];
  const errors: unknown[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') imported.push({ asset: result.value, alt: items[index].alt });
    else errors.push(result.reason);
  });
  if (errors.length > 0) {
    showToast({
      message: errors.length === 1 ? importError(errors[0]) : t('images.failed', { count: errors.length }),
      tone: 'danger',
    });
  }
  if (imported.length === 0) return [];
  const table = assetTable(mounted.page);
  imported.forEach(({ asset }) => table.add(asset.id, asset.asset));
  const { edits, blocks } = imageEdits(mounted, imported, place, sizingFor(choice));
  const ack = await mounted.sync.send({ edits });
  showInserted(mounted, edits, ack.orderKeys);
  if (choice === 'ask') offerActualSize(mounted, blocks);
  selectOnPage({ blocks: blocks.slice(0, 1), strokes: [] });
  mounted.layer.view(blocks[0])?.element.focus({ preventScroll: false });
  announce(t('images.added', { count: blocks.length }));
  return blocks;
}

/** Shows blocks this window inserted, at the order keys the service gave them. */
export function showInserted(
  mounted: Pick<MountedPage, 'layer'>,
  edits: readonly Edit[],
  orderKeys: Readonly<Record<BlockId, string>>,
): void {
  const now = new Date().toISOString();
  for (const edit of edits) {
    if (edit.edit !== 'insertBlock') continue;
    const { id } = edit.block;
    mounted.layer.upsert({ ...edit.block, order: orderKeys[id] ?? 'zz', created: now, modified: now });
  }
}

/** Image files from a list, and whether any other files were left out. */
export function imageFiles(files: readonly File[], convert: boolean): { images: File[]; others: number } {
  const allowed = new Set<string>([...IMAGE_TYPES, ...(convert ? CONVERTIBLE_TYPES : [])]);
  const images = files.filter((file) => allowed.has(file.type.toLowerCase()));
  return { images, others: files.length - images.length };
}

export function fileItems(files: readonly File[]): QueuedImage[] {
  return files.map((file) => ({ kind: 'file', file, name: file.name || 'image' }));
}

/** The world rectangle of a client point, for a drop. */
export function dropPoint(mounted: MountedPage, clientX: number, clientY: number): PageRect {
  const point = mounted.viewport.toWorld(clientX, clientY);
  return { x: Math.max(0, point.x), y: Math.max(0, point.y), w: 0, h: 0 };
}

/** Opens the Windows open dialog for images and inserts what the person picks. */
export function pickImages(mounted: MountedPage, convert: boolean): Promise<BlockId[]> {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = [...IMAGE_TYPES, ...(convert ? CONVERTIBLE_TYPES : [])].join(',');
  const place = defaultPlacement(mounted);
  return new Promise((resolve) => {
    input.addEventListener('change', () => {
      const { images } = imageFiles([...(input.files ?? [])], convert);
      resolve(insertImages(mounted, fileItems(images), place));
    });
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
