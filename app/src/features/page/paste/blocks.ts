// Copying blocks out of OpenNote and pasting them back (Phase 4 ARCHITECTURE.md sections 15.3 and 15.8). A block
// selection is written as `text/html` from the schema's serializer, which Word, Google Docs, and OneNote read well,
// with a `data-opennote-blocks` payload, and as `text/plain` Markdown. Pasting the payload brings the blocks back
// with frames relative to the first one; an image from another page is re-imported from its bytes.
import { DOMSerializer } from '@tiptap/pm/model';
import { newId } from '../../../editor/ids';
import { serializeTextBlock } from '../../../editor/markdown';
import type { BlockId, Edit, Frame, NewBlock } from '../../../services/pages/types';
import { imageHandle, imageLabel } from '../blocks/imageBlock';
import { assetTable } from '../images/assets';
import type { Placement } from '../images/insert';
import { showInserted } from '../images/insert';
import type { MountedPage } from '../mount';
import { clipboardFormats } from '../registries';
import { pageSelection } from '../seams/selectionStore';
import { parseHtml } from './dom';

export const PAYLOAD_ATTRIBUTE = 'data-opennote-blocks';

export interface CopiedBlock {
  /** Copying writes text and images only: any other block is copied as its text. */
  type: 'text' | 'image';
  frame: Frame | null;
  data: Record<string, unknown>;
  /** For an image: where its bytes can be read while the page is open. */
  assetUrl?: string;
  assetName?: string;
}

export interface BlockPayload {
  v: 1;
  page: string;
  blocks: CopiedBlock[];
}

/** One block as data, its HTML, and its Markdown. */
function copyBlock(mounted: MountedPage, id: BlockId): { block: CopiedBlock; html: string; markdown: string } | null {
  const view = mounted.layer.view(id);
  if (!view) return null;
  const rect = view.measure();
  const image = imageHandle(id);
  if (image) {
    const block = image.block();
    const asset = typeof block.data.asset === 'string' ? block.data.asset : null;
    const alt = typeof block.data.alt === 'string' ? block.data.alt : '';
    const element = document.createElement('img');
    element.alt = block.data.decorative === true ? '' : alt;
    if (image.asset()?.width) element.width = Math.round(rect.w);
    return {
      block: {
        type: 'image',
        frame: block.frame ?? null,
        data: { ...block.data },
        ...(asset ? { assetUrl: mounted.page.assetUrl(asset), assetName: image.asset()?.name ?? 'image' } : {}),
      },
      html: element.outerHTML,
      markdown: imageMarkdown(alt, image.asset()?.file ?? null, imageLabel(block)),
    };
  }
  const editor = mounted.pool.editor(id);
  if (editor) {
    const markdown = serializeTextBlock(editor.state.doc, mounted.cache);
    const holder = document.createElement('div');
    holder.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.content));
    const floating = view.element.style.left !== '';
    return {
      block: { type: 'text', frame: floating ? { x: rect.x, y: rect.y, w: rect.w } : null, data: { markdown } },
      html: holder.innerHTML,
      markdown,
    };
  }
  const text = view.element.innerText ?? view.element.textContent ?? '';
  return {
    block: { type: 'text', frame: null, data: { markdown: text } },
    html: `<p>${escapeHtml(text)}</p>`,
    markdown: text,
  };
}

/** An image as page.md writes it (SPEC 11.1), or its name when its file isn't known. */
function imageMarkdown(alt: string, file: string | null, label: string): string {
  if (!file) return label;
  return `![${alt.replace(/[[\]\\]/g, '\\$&')}](assets/${encodeURI(file)})`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
}

/** Writes the selected blocks to a clipboard event's data. Returns whether there was anything to write. */
export function writeBlocks(mounted: MountedPage, ids: readonly BlockId[], data: DataTransfer): boolean {
  const copied = ids.map((id) => copyBlock(mounted, id)).filter((entry) => entry !== null);
  if (copied.length === 0) return false;
  const payload: BlockPayload = { v: 1, page: mounted.page.id, blocks: copied.map((entry) => entry.block) };
  const holder = document.createElement('div');
  holder.setAttribute(PAYLOAD_ATTRIBUTE, JSON.stringify(payload));
  holder.innerHTML = copied.map((entry) => entry.html).join('\n');
  data.setData('text/html', holder.outerHTML);
  data.setData('text/plain', copied.map((entry) => entry.markdown).join('\n\n'));
  for (const format of clipboardFormats.list()) format.write?.(pageSelection.get(), data);
  return true;
}

/** The payload of copied OpenNote blocks, if the HTML holds one. */
export function readBlockPayload(html: string | null): BlockPayload | null {
  if (!html || !html.includes(PAYLOAD_ATTRIBUTE)) return null;
  const holder = parseHtml(html).querySelector(`[${PAYLOAD_ATTRIBUTE}]`);
  try {
    const payload = JSON.parse(holder?.getAttribute(PAYLOAD_ATTRIBUTE) ?? '') as BlockPayload;
    if (payload?.v !== 1 || !Array.isArray(payload.blocks)) return null;
    const valid = payload.blocks.every(
      (block) =>
        (block?.type === 'text' || block?.type === 'image') && block.data !== null && typeof block.data === 'object',
    );
    return valid ? payload : null;
  } catch {
    return null;
  }
}

/** Pastes copied blocks, re-importing images from another page. One batch. */
export async function pasteBlocks(mounted: MountedPage, payload: BlockPayload, place: Placement): Promise<BlockId[]> {
  const samePage = payload.page === mounted.page.id;
  const floating = payload.blocks.map((block) => block.frame).filter((frame) => frame?.x !== undefined);
  const originX = Math.min(...floating.map((frame) => frame!.x!), Number.POSITIVE_INFINITY);
  const originY = Math.min(...floating.map((frame) => frame!.y!), Number.POSITIVE_INFINITY);
  const edits: Edit[] = [];
  const ids: BlockId[] = [];
  let after = place.kind === 'after' ? place.block : null;
  let stackY = place.kind === 'point' ? place.y : 0;
  for (const copied of payload.blocks) {
    const data = { ...copied.data };
    if (copied.type === 'image') {
      const asset = await reimport(mounted, copied, samePage);
      if (!asset) continue;
      data.asset = asset;
      edits.push({ edit: 'addAsset', asset });
    }
    let frame: Frame | undefined;
    if (place.kind === 'point') {
      const own = copied.frame;
      frame =
        own?.x !== undefined && own.y !== undefined
          ? { ...own, x: place.x + own.x - originX, y: place.y + own.y - originY }
          : { ...(own?.w ? { w: own.w } : {}), x: place.x, y: stackY };
      stackY = Math.max(stackY, (frame.y ?? 0) + (frame.h ?? 48) + 24);
    } else if (copied.frame?.w) frame = { w: copied.frame.w };
    const id = newId();
    const block: NewBlock = { id, type: copied.type, data, ...(frame ? { frame } : {}) };
    edits.push(after ? { edit: 'insertBlock', block, after } : { edit: 'insertBlock', block });
    ids.push(id);
    if (place.kind === 'after') after = id;
  }
  if (ids.length === 0) return [];
  const ack = await mounted.sync.send({ edits });
  showInserted(mounted, edits, ack.orderKeys);
  return ids;
}

async function reimport(mounted: MountedPage, copied: CopiedBlock, samePage: boolean): Promise<string | null> {
  const asset = typeof copied.data.asset === 'string' ? copied.data.asset : null;
  if (samePage && asset && assetTable(mounted.page).get(asset)) return asset;
  if (!copied.assetUrl) return null;
  try {
    const blob = await (await fetch(copied.assetUrl)).blob();
    const imported = await mounted.page.importImage({
      kind: 'bytes',
      bytes: await blob.arrayBuffer(),
      name: copied.assetName ?? 'image',
      mime: blob.type || 'image/png',
    });
    assetTable(mounted.page).add(imported.id, imported.asset);
    return imported.id;
  } catch {
    return null;
  }
}
