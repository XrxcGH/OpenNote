// What the elements library does with the shown page: keep the picked items as an element, and put an element back on
// the page. Images travel inside the element as base64, so an element works in any notebook.
import { newId } from '../../../editor/ids';
import type { Edit, ImportedAsset, NewBlock } from '../../../services/pages/types';
import { documentCss, lightTheme } from '../export';
import { addElement, elementSvg, fitScale, insertElement, makeElement } from '../elements';
import type { ElementAsset, ElementData, ElementEntry } from '../elements';
import { shownMounted } from '../../page';
import { fromBase64, toBase64 } from './base64';
import { chosenSelection } from './chosen';
import { exportLabels } from './exporter';
import { changeLibrary } from './elementStore';
import type { Changed } from './elementStore';
import { svgToPng } from './picture';
import { blockBoxes } from './picture';
import type { PageSource } from './source';

/** The base64 bytes of the assets the picked image blocks use, read once so `makeElement` can look them up. */
async function assetData(source: PageSource, blocks: readonly string[]): Promise<Map<string, string>> {
  const wanted = new Set(
    source.page.blocks.flatMap((b) => (b.type === 'image' && blocks.includes(b.id) ? [b.asset] : [])),
  );
  const found = new Map<string, string>();
  await Promise.all(
    [...wanted].map(async (id) => {
      const url = source.assetUrls[id];
      if (!url) return;
      try {
        const response = await fetch(url);
        if (response.ok) found.set(id, toBase64(new Uint8Array(await response.arrayBuffer())));
      } catch {
        // An image whose bytes can't be read is left out, and counted as skipped.
      }
    }),
  );
  return found;
}

export type SaveOutcome =
  | { readonly ok: true; readonly skipped: number; readonly saved: boolean }
  | { readonly ok: false; readonly error: 'nothing' | NonNullable<Changed['error']> };

/** Keeps the picked blocks and strokes of the shown page as an element in `folder`. */
export async function saveAsElement(source: PageSource, name: string, folder: string): Promise<SaveOutcome> {
  const selection = chosenSelection(source);
  if (!selection) return { ok: false, error: 'nothing' };
  const data = await assetData(source, selection.blocks);
  const made = makeElement(source.page, selection, {
    boxes: blockBoxes(),
    assetData: (asset) => data.get(asset.id) ?? null,
    alt: name,
  });
  const entry: ElementEntry = {
    id: newId(),
    name,
    folder,
    created: new Date().toISOString(),
    element: made.element,
  };
  const changed = await changeLibrary((library) => addElement(library, entry));
  if (changed.error === 'notSaved') return { ok: true, skipped: made.skipped, saved: false };
  return changed.error ? { ok: false, error: changed.error } : { ok: true, skipped: made.skipped, saved: true };
}

/** An element as a picture for the library: its own images as data URIs. */
export function thumbnail(element: ElementData): string {
  const theme = lightTheme();
  return elementSvg(element, {
    assetUrl: (_id: string, asset: ElementAsset | undefined) =>
      asset ? `data:${asset.mime};base64,${asset.data}` : null,
    background: theme.colors.page,
    css: documentCss(theme),
    labels: exportLabels(),
    label: element.alt ?? '',
  });
}

const bufferOf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/**
 * Puts an element on the shown page, scaled to fit the window and centered in it, as one undo step. Text, tables, and
 * images become blocks. Ink becomes one picture block of the handwriting, because the ink view draws the strokes it
 * made itself.
 */
export async function insertEntry(entry: ElementEntry): Promise<boolean> {
  const mounted = shownMounted.get();
  if (!mounted || mounted.page.readOnly) return false;
  const { element } = entry;
  const camera = mounted.viewport.camera();
  const visible = { w: camera.viewport.w / camera.zoom, h: camera.viewport.h / camera.zoom };
  const scale = fitScale(element, { w: visible.w * 0.8, h: visible.h * 0.8 });
  const left = camera.scrollX / camera.zoom;
  const top = camera.scrollY / camera.zoom;
  const at = {
    x: Math.max(0, left + (visible.w - element.width * scale) / 2),
    y: Math.max(0, top + (visible.h - element.height * scale) / 2),
  };
  const inserted = insertElement(element, { at, scale, inkBlock: 'unused', ids: () => newId(), start: Date.now() });
  const imported = new Map<string, ImportedAsset>();
  const edits: Edit[] = [];
  for (const asset of inserted.assets) {
    const bytes = bufferOf(fromBase64(asset.data));
    const result = await mounted.page.importImage({ kind: 'bytes', bytes, name: asset.name, mime: asset.mime });
    imported.set(asset.id, result);
    edits.push({ edit: 'addAsset', asset: result.id });
  }
  for (const block of inserted.blocks) {
    const frame = block.frame;
    let made: NewBlock | null = null;
    if (block.type === 'text') made = { id: block.id, type: 'text', frame, data: { markdown: block.markdown } };
    else if (block.type === 'table') {
      const { header, columns, rows } = block;
      made = { id: block.id, type: 'table', frame, data: { header, columns, rows } };
    } else if (block.type === 'image') {
      const asset = imported.get(block.asset);
      if (asset) {
        const data = { asset: asset.id, alt: block.alt, ...(block.decorative ? { decorative: true } : {}) };
        made = { id: block.id, type: 'image', frame, data };
      }
    }
    if (made) edits.push({ edit: 'insertBlock', block: made });
  }
  if (element.strokes.length > 0) {
    const ink = { ...element, blocks: [], assets: {} };
    const svg = elementSvg(ink, { assetUrl: () => null, label: element.alt ?? entry.name });
    const width = Math.max(1, element.width);
    const height = Math.max(1, element.height);
    const blob = await svgToPng({ svg, width, height, selection: undefined as never }, 2);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = await mounted.page.importImage({
      kind: 'bytes',
      bytes: bufferOf(bytes),
      name: `${entry.name}.png`,
      mime: 'image/png',
    });
    const frame = { x: at.x, y: at.y, w: width * scale, h: height * scale };
    edits.push({ edit: 'addAsset', asset: result.id });
    edits.push({
      edit: 'insertBlock',
      block: { id: newId(), type: 'image', frame, data: { asset: result.id, alt: element.alt ?? entry.name } },
    });
  }
  if (edits.length === 0) return false;
  await mounted.sync.send({ edits });
  return true;
}
