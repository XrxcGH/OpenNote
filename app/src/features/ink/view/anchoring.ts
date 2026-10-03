// Ink that stays with its text, on the page. Ink drawn on typed text goes into its own anchored ink block, tied to the
// words it touches by a place in the text and a quote of the words around it. When the text is edited, reflowed, or
// restyled the quote finds the place again and the ink moves by as far as the place moved. The move is made in the
// picture and not saved as a step, so undoing the text edit never has to undo an ink move too; the place is found again
// each time the page opens, and the exports read the picture.
import { newId } from '../../../editor/ids';
import { isEnabled } from '../../../app/flags';
import { getSettings } from '../../../state/settings';
import type { Store } from '../../../state/store';
import type { BlockJson, Edit } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { codePoints, findAnchor, followDelta, offsetFrom, quoteAt, readAnchor } from '../anchor';
import type { Quote } from '../anchor';
import { strokeBounds, union } from '../geometry/bounds';
import { compose, translation } from '../geometry/matrix';
import type { Bounds, Matrix } from '../geometry/types';
import type { InkStroke } from '../model/types';
import type { InkHost } from './host';
import type { InkSurface } from './surface';

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** Ink moves only when its place moved at least this far, in page units. */
const MIN_MOVE = 0.5;
/** A stroke this soon after the last anchored one, and this near it, joins the same anchored block. */
const JOIN_MS = 5000;
const JOIN_NEAR = 120;

const textNodes = (root: Node): Text[] => {
  const nodes: Text[] = [];
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
};

const displayed = (root: Node): string =>
  textNodes(root)
    .map((node) => node.data)
    .join('');

type DocWithCaret = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const d = doc as DocWithCaret;
  const position = d.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = d.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

export interface TextPlace {
  readonly block: string;
  readonly at: number;
  readonly quote: Quote;
  /** The caret's place on the screen. */
  readonly x: number;
  readonly y: number;
}

/** The typed words under a screen point, as an anchor place. Null over anything but text. */
export function placeAt(doc: Document, clientX: number, clientY: number, reach = 28): TextPlace | null {
  for (const element of doc.elementsFromPoint(clientX, clientY)) {
    const holder = element.closest<HTMLElement>('[data-block-id]');
    if (!holder || holder.dataset.ink !== undefined || !holder.dataset.blockId) continue;
    const rect = holder.getBoundingClientRect();
    if (clientX < rect.left - reach || clientX > rect.right + reach) continue;
    // A point in the margin falls to the nearest edge of the text, so a note beside a paragraph still finds it.
    const x = Math.min(Math.max(clientX, rect.left + 1), rect.right - 1);
    const caret = caretAt(doc, x, clientY);
    if (!caret || !holder.contains(caret.node)) continue;
    let index = 0;
    for (const node of textNodes(holder)) {
      if (node === caret.node) {
        index += caret.offset;
        break;
      }
      index += node.data.length;
    }
    const text = displayed(holder);
    const at = codePoints(text.slice(0, index));
    const range = doc.createRange();
    range.setStart(caret.node, caret.offset);
    range.collapse(true);
    const spot = range.getBoundingClientRect();
    return {
      block: holder.dataset.blockId,
      at,
      quote: quoteAt(text, at),
      x: spot.width === 0 && spot.height === 0 ? x : spot.left,
      y: spot.height === 0 ? clientY : spot.top,
    };
  }
  return null;
}

/** Where an anchor's place is on the screen now, or null when the words are gone. */
export function placeNow(holder: HTMLElement, anchor: { at: number; quote: Quote }): { x: number; y: number } | null {
  const text = displayed(holder);
  const found = findAnchor(text, anchor.at, anchor.quote);
  if (found === null) return null;
  let remaining = Array.from(text).slice(0, found).join('').length;
  const range = holder.ownerDocument.createRange();
  for (const node of textNodes(holder)) {
    if (remaining <= node.data.length) {
      range.setStart(node, remaining);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    }
    remaining -= node.data.length;
  }
  return null;
}

/** An anchored ink block, as the page holds it. */
function anchoredBlocks(host: InkHost): BlockJson[] {
  return (host.layer.get()?.blocks() ?? []).filter((block) => block.type === 'ink' && readAnchor(block.data) !== null);
}

/** Moves anchored ink to where its words are now. Returns how many blocks moved. */
export function followAnchors(host: InkHost, surface: InkSurface): number {
  const layer = host.layer.get();
  const viewport = host.viewport.get();
  if (!layer || !viewport) return 0;
  let moved = 0;
  for (const block of anchoredBlocks(host)) {
    // The slot an anchored block has in the page must never take a click meant for the text below it.
    const slot = layer.view(block.id)?.element;
    if (slot) slot.style.pointerEvents = 'none';
    const anchor = readAnchor(block.data)!;
    const holder = layer.view(anchor.block)?.element;
    const strokes = ([...surface.index.all()] as InkStroke[]).filter((stroke) => stroke.block === block.id);
    if (!holder || strokes.length === 0) continue;
    const place = placeNow(holder, anchor);
    if (!place) continue;
    const at = viewport.toWorld(place.x, place.y);
    const box = strokes.map(strokeBounds).reduce(union);
    const delta = followDelta(at, anchor, { x: box.minX, y: box.minY });
    if (Math.abs(delta.x) < MIN_MOVE && Math.abs(delta.y) < MIN_MOVE) continue;
    const by = translation(delta.x, delta.y);
    surface.show(strokes.map((stroke) => ({ ...stroke, transform: compose(by, stroke.transform ?? IDENTITY) })));
    moved++;
  }
  return moved;
}

/** Follows the text for as long as the page is shown: edits, reflow, restyling, and the first load all re-check. */
export function installAnchoring(host: InkHost, surfaces: Store<InkSurface | null>): () => void {
  let stop: (() => void) | null = null;
  const attach = () => {
    stop?.();
    stop = null;
    const surface = surfaces.get();
    const viewport = host.viewport.get();
    if (!surface || !viewport || !isEnabled('ink.anchoring')) return;
    let timer = 0;
    let busy = false;
    const run = () => {
      timer = 0;
      busy = true;
      try {
        followAnchors(host, surface);
      } finally {
        busy = false;
      }
    };
    const schedule = () => {
      if (!busy && !timer) timer = window.setTimeout(run, 120);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(viewport.world, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    const stops = [surface.onChange(schedule), host.layer.subscribe(schedule)];
    schedule();
    stop = () => {
      observer.disconnect();
      stops.forEach((s) => s());
      window.clearTimeout(timer);
    };
  };
  const stops = [surfaces.subscribe(attach), host.viewport.subscribe(attach)];
  attach();
  return () => {
    stops.forEach((s) => s());
    stop?.();
  };
}

// ---- making anchors ----

export interface Anchored {
  readonly strokes: InkStroke[];
  readonly edits: Edit[];
  readonly block: string;
}

/** Ink the pen just drew on text: the last anchored block, so a note of several strokes shares one. */
let recent: { block: string; holder: string; box: Bounds; at: number } | null = null;

function probes(box: Bounds): { x: number; y: number }[] {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return [
    { x: cx, y: cy },
    { x: cx, y: box.minY - 6 },
    { x: box.minX, y: cy },
    { x: box.maxX, y: cy },
    { x: box.minX - 10, y: cy },
  ];
}

/**
 * Ties strokes to the typed words they lie on. Returns the strokes in their new anchored block and the edit that makes
 * the block, or null when the ink is not on text.
 */
export function anchorStrokes(
  host: InkHost,
  surface: InkSurface,
  strokes: readonly InkStroke[],
  join = true,
): Anchored | null {
  const viewport = host.viewport.get();
  if (!viewport || strokes.length === 0) return null;
  const doc = viewport.viewport.ownerDocument;
  const box = strokes.map(strokeBounds).reduce(union);
  const camera = surface.cameraNow();
  const toClient = (p: { x: number; y: number }) => ({
    x: camera.viewport.x + p.x * camera.zoom - camera.scrollX,
    y: camera.viewport.y + p.y * camera.zoom - camera.scrollY,
  });
  let place: TextPlace | null = null;
  for (const probe of probes(box)) {
    const at = toClient(probe);
    place = placeAt(doc, at.x, at.y);
    if (place) break;
  }
  if (!place) return null;
  const now = Date.now();
  if (join && recent && recent.holder === place.block && now - recent.at < JOIN_MS) {
    const near =
      box.minX < recent.box.maxX + JOIN_NEAR &&
      box.maxX > recent.box.minX - JOIN_NEAR &&
      box.minY < recent.box.maxY + JOIN_NEAR &&
      box.maxY > recent.box.minY - JOIN_NEAR;
    if (near) {
      recent = { ...recent, box: union(recent.box, box), at: now };
      return { strokes: strokes.map((s) => ({ ...s, block: recent!.block })), edits: [], block: recent.block };
    }
  }
  const at = viewport.toWorld(place.x, place.y);
  const offset = offsetFrom(at, { x: box.minX, y: box.minY });
  const id = newId();
  const data = {
    role: 'anchored',
    anchor: { block: place.block, at: place.at, quote: place.quote, dx: offset.dx, dy: offset.dy },
  };
  const made = new Date().toISOString();
  host.layer
    .get()
    ?.upsert({ id, type: 'ink', order: 'zz', frame: { x: 0, y: 0 }, created: made, modified: made, data });
  recent = { block: id, holder: place.block, box, at: now };
  return {
    strokes: strokes.map((s) => ({ ...s, block: id })),
    edits: [{ edit: 'insertBlock', block: { id, type: 'ink', frame: { x: 0, y: 0 }, data } }],
    block: id,
  };
}

/**
 * The edits that keep anchored ink where the person put it. Moving or resizing anchored ink changes how far it sits from
 * its words, so the new offset is saved with the move. `restore` puts the page's copy of the blocks back if the move fails.
 */
export function anchorOffsetEdits(
  host: InkHost,
  surface: InkSurface,
  ids: readonly string[],
  matrix: Matrix,
): { edits: Edit[]; restore: () => void } {
  const layer = host.layer.get();
  const edits: Edit[] = [];
  const before: BlockJson[] = [];
  if (!layer || !isEnabled('ink.anchoring')) return { edits, restore: () => undefined };
  const moved = new Set(ids);
  const everything = [...surface.index.all()] as InkStroke[];
  for (const block of new Set(surface.strokes(ids).map((stroke) => stroke.block))) {
    const held = layer.block(block);
    const anchor = held ? readAnchor(held.data) : null;
    if (!held || !anchor) continue;
    const strokes = everything.filter((stroke) => stroke.block === block);
    const from = strokes.map(strokeBounds).reduce(union);
    const to = strokes
      .map((stroke) =>
        strokeBounds(
          moved.has(stroke.id) ? { ...stroke, transform: compose(matrix, stroke.transform ?? IDENTITY) } : stroke,
        ),
      )
      .reduce(union);
    const dx = anchor.dx + (to.minX - from.minX);
    const dy = anchor.dy + (to.minY - from.minY);
    edits.push({ edit: 'patchBlock', block, data: { anchor: { dx, dy } } });
    before.push(held);
    layer.upsert({ ...held, data: { ...held.data, anchor: { ...(held.data.anchor as object), dx, dy } } });
  }
  return { edits, restore: () => before.forEach((held) => layer.upsert(held)) };
}

/** Whether new ink drawn on typed text is tied to it on its own. */
export const autoAnchor = (): boolean => isEnabled('ink.anchoring') && getSettings().ink.anchorToText;

/** Ties the selected ink to the text it lies on. */
export async function anchorSelection(host: InkHost, surface: InkSurface): Promise<void> {
  const strokes = surface.strokes(host.selection.get().strokes);
  const made = anchorStrokes(host, surface, strokes, false);
  if (!made || surface.readOnly) {
    announce(t('ink.anchor.notOnText'));
    return;
  }
  const before = strokes;
  surface.show(made.strokes);
  const ok = await surface.send(
    { edits: [...made.edits, { edit: 'moveStrokesToBlock', strokes: strokes.map((s) => s.id), block: made.block }] },
    () => surface.show(before),
  );
  if (ok) announce(t('ink.anchor.anchored'));
}

/** Lets the selected ink go back to the page's ink layer, so it stays where it is when the text moves. */
export async function detachSelection(host: InkHost, surface: InkSurface): Promise<void> {
  const anchored = new Set(anchoredBlocks(host).map((block) => block.id));
  const strokes = surface.strokes(host.selection.get().strokes).filter((stroke) => anchored.has(stroke.block));
  if (strokes.length === 0 || surface.readOnly) {
    announce(t('ink.anchor.noneToDetach'));
    return;
  }
  const target = surface.layerFor();
  const edits: Edit[] = [{ edit: 'moveStrokesToBlock', strokes: strokes.map((s) => s.id), block: target }];
  const ok = await surface.send({ edits: [...surface.takeLayerEdit(), ...edits] }, () => surface.show(strokes));
  if (ok) {
    surface.show(strokes.map((s) => ({ ...s, block: target })));
    announce(t('ink.anchor.detached'));
  }
}
