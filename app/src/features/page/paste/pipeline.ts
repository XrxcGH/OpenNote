// The paste and drop pipeline (Phase 4 ARCHITECTURE.md section 15.1): read, facts, classify, normalize, split,
// images, apply, and extras. The text goes into the focused editor at once, so a one-page paste shows within 50 ms;
// tables, later text, and images become blocks after it (flow) or below it (freeform), and images follow as their
// imports finish. Each extra is its own undo step.
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { newId } from '../../../editor/ids';
import { serializeTextBlock } from '../../../editor/markdown';
import { textSchema } from '../../../editor/schema/schema';
import type { ClipboardClient, ClipboardFacts } from '../../../platform/types';
import type { BlockId, Edit, Frame, ImportedAsset, NewBlock } from '../../../services/pages/types';
import { getSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { attachFiles } from '../attachments/attach';
import { droppedLink } from '../attachments/dropLink';
import { insertDroppedLink } from '../attachments/linkDrop';
import { assetTable } from '../images/assets';
import { offerActualSize, pasteSizeChoice, sizingFor } from '../qol/pasteSize';
import type { Placement } from '../images/insert';
import {
  currentBlock,
  defaultPlacement,
  fileItems,
  imageEdits,
  imageFiles,
  importError,
  importsFor,
  insertImages,
  isFlow,
  showInserted,
} from '../images/insert';
import type { QueuedImage } from '../images/importQueue';
import type { MountedPage } from '../mount';
import { addSourceLink, joinPdfLines, linkOverSelection } from './extras';
import { factsFor } from './facts';
import { imageKind } from './images';
import { readBlockPayload, pasteBlocks } from './blocks';
import { sanitizePaste } from './sanitize';
import type { ImageRequest, PasteResult, PastedPiece } from './types';

export interface PasteRequest {
  html: string | null;
  text: string | null;
  files: readonly File[];
  /** Ctrl+Shift+V: plain text, no Markdown. */
  plain: boolean;
  origin: 'paste' | 'drop' | 'menu';
  /** A drop's client point. */
  point?: { clientX: number; clientY: number };
  /** Facts already read with the content (the context menu's Paste). */
  facts?: ClipboardFacts | null;
  /** The event landed in the active editor; otherwise the content becomes new blocks. */
  intoEditor?: boolean;
}

/** What the pipeline applies, in order. */
export type ApplyPiece = PastedPiece | { kind: 'image'; request: ImageRequest };

const KEEP_BELOW = 24;
let flagged: (id: 'page.pasteExtras' | 'page.images' | 'page.heicImport') => boolean = () => true;

/** The flag reader, from the page's editor host. */
export function setPasteFlags(read: typeof flagged): void {
  flagged = read;
}

/**
 * Splits text pieces at their images, which become image blocks after the block that held them. An image whose
 * description is a character or two (an emoji picture) stays as that text.
 */
export function splitImages(pieces: readonly PastedPiece[]): ApplyPiece[] {
  const out: ApplyPiece[] = [];
  for (const piece of pieces) {
    if (piece.kind !== 'text') {
      out.push(piece);
      continue;
    }
    let run: PMNode[] = [];
    const flush = () => {
      if (run.length > 0) out.push({ kind: 'text', doc: textSchema.nodes.doc.create(null, Fragment.from(run)) });
      run = [];
    };
    piece.doc.forEach((block) => {
      const requests: ImageRequest[] = [];
      const rest = withoutImages(block, requests);
      if (rest && !(rest.type.name === 'paragraph' && rest.textContent.trim() === '' && requests.length > 0)) {
        run.push(rest);
      }
      if (requests.length === 0) return;
      flush();
      requests.forEach((request) => out.push({ kind: 'image', request }));
    });
    flush();
  }
  return out;
}

const isEmojiPicture = (alt: string) => alt.trim() !== '' && [...alt.trim()].length <= 2;

/** The node with its images taken out into `requests`, emoji pictures turned into their text. */
function withoutImages(node: PMNode, requests: ImageRequest[]): PMNode | null {
  if (node.isLeaf) return node;
  let changed = false;
  const children: PMNode[] = [];
  node.forEach((child) => {
    if (child.type.name !== 'image') {
      const next = withoutImages(child, requests);
      changed ||= next !== child;
      if (next) children.push(next);
      return;
    }
    changed = true;
    const src = child.attrs.src as string;
    const alt = ((child.attrs.alt as string) ?? '').trim();
    const kind = imageKind(src);
    if (kind && !isEmojiPicture(alt)) requests.push({ kind, src, alt });
    else if (alt) children.push(textSchema.text(alt, child.marks));
  });
  if (!changed) return node;
  if (node.isTextblock) trimEdges(children);
  return node.type.createAndFill(node.attrs, Fragment.from(children), node.marks);
}

/** Drops the spaces an image left at the start or end of a text block. */
function trimEdges(children: PMNode[]): void {
  const first = children[0];
  if (first?.isText && first.text) {
    const text = first.text.trimStart();
    if (text) children[0] = textSchema.text(text, first.marks);
    else children.shift();
  }
  const last = children[children.length - 1];
  if (last?.isText && last.text) {
    const text = last.text.trimEnd();
    if (text) children[children.length - 1] = textSchema.text(text, last.marks);
    else children.pop();
  }
}

/** The import for an image in pasted content (section 15.5), or null when it is dropped or only linked. */
export async function imageSource(
  request: ImageRequest,
  facts: ClipboardFacts | null,
  saveWebImages: boolean,
): Promise<QueuedImage | null> {
  if (request.kind === 'data' || request.kind === 'blob') {
    const decoded = request.kind === 'data' ? dataUrlBytes(request.src) : null;
    const bytes = decoded?.bytes ?? (await (await fetch(request.src)).arrayBuffer());
    const mime = decoded?.mime ?? 'image/png';
    const name = `image.${(mime.split('/')[1] ?? 'png').replace('svg+xml', 'svg')}`;
    return { kind: 'bytes', bytes, name, mime };
  }
  if (request.kind === 'remote') return saveWebImages ? { kind: 'url', url: request.src } : null;
  const token = facts?.wordImages.find((image) => image.src === request.src)?.token;
  return token ? { kind: 'clipToken', token } : null;
}

/** The bytes and type of a `data:` URL, decoded in the page (section 15.5). */
export function dataUrlBytes(src: string): { bytes: ArrayBuffer; mime: string } | null {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(src);
  if (!match) return null;
  const mime = (match[1] || 'text/plain').toLowerCase();
  const base64 = /;base64/i.test(match[2]);
  const text = base64 ? atob(match[3].replace(/\s+/g, '')) : decodeURIComponent(match[3]);
  const bytes = base64 ? Uint8Array.from(text, (char) => char.charCodeAt(0)) : new TextEncoder().encode(text);
  return { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, mime };
}

/** A text piece as a new text block's Markdown. */
function markdownOf(doc: PMNode, mounted: MountedPage): string {
  return serializeTextBlock(doc, mounted.cache);
}

/** Inserts a text piece at the editor's selection. Its first and last paragraphs join the text around them. */
export function insertIntoEditor(editor: Editor, doc: PMNode): { from: number; to: number } {
  const converted = editor.schema.nodeFromJSON(doc.toJSON());
  const slice = Slice.maxOpen(converted.content);
  const { state } = editor.view;
  const from = state.selection.from;
  const tr = state.tr.replaceSelection(slice);
  // jsdom has no layout to scroll by.
  if (typeof Range !== 'undefined' && 'getClientRects' in Range.prototype) tr.scrollIntoView();
  editor.view.dispatch(tr);
  return { from, to: editor.state.selection.to };
}

interface Placed {
  edits: Edit[];
  blocks: BlockId[];
}

/** New blocks for the pieces after the text, after `after` (flow) or stacked below `below` (freeform). */
function blockEdits(mounted: MountedPage, pieces: readonly PastedPiece[], place: Placement): Placed {
  const edits: Edit[] = [];
  const blocks: BlockId[] = [];
  let after = place.kind === 'after' ? place.block : null;
  let y = place.kind === 'point' ? place.y : 0;
  for (const piece of pieces) {
    const id = newId();
    const data = piece.kind === 'text' ? { markdown: markdownOf(piece.doc, mounted) } : { ...piece.data };
    const type = piece.kind === 'text' ? 'text' : 'table';
    const estimate = piece.kind === 'text' ? piece.doc.childCount * 28 : (piece.data.rows.length + 1) * 36;
    const frame: Frame | undefined = place.kind === 'point' ? { x: place.x, y } : undefined;
    const block: NewBlock = { id, type, data, ...(frame ? { frame } : {}) };
    edits.push(after ? { edit: 'insertBlock', block, after } : { edit: 'insertBlock', block });
    blocks.push(id);
    if (place.kind === 'after') after = id;
    y += estimate + KEEP_BELOW;
  }
  return { edits, blocks };
}

/** A flowing block inserted after the last new image instead, so the links follow the images. */
function afterLast(edit: Edit, images: readonly BlockId[]): Edit {
  if (edit.edit !== 'insertBlock' || images.length === 0 || edit.block.frame?.x !== undefined) return edit;
  return { ...edit, after: images[images.length - 1] };
}

/** Where the blocks after the pasted text go. */
function placementAfter(mounted: MountedPage, block: BlockId | null, point?: PasteRequest['point']): Placement {
  if (point && !isFlow(mounted.page)) {
    const world = mounted.viewport.toWorld(point.clientX, point.clientY);
    return { kind: 'point', x: Math.max(0, world.x), y: Math.max(0, world.y) };
  }
  if (isFlow(mounted.page)) return { kind: 'after', block };
  const below = block ? mounted.layer.view(block)?.measure() : null;
  return below ? { kind: 'point', x: below.x, y: below.y + below.h + KEEP_BELOW } : defaultPlacement(mounted);
}

/** The pieces as one paste result, from the request. */
export function resultFor(request: PasteRequest, facts: ClipboardFacts | null, target: 'text' | 'page'): PasteResult {
  return sanitizePaste(
    { html: request.plain ? null : request.html, text: request.text, facts, files: request.files, target },
    { plain: request.plain },
  );
}

async function importAll(
  mounted: MountedPage,
  requests: readonly ImageRequest[],
  facts: ClipboardFacts | null,
  saveWebImages: boolean,
): Promise<{ imported: { asset: ImportedAsset; alt: string }[]; linked: ImageRequest[] }> {
  const queue = importsFor(mounted);
  const done = await Promise.allSettled(
    requests.map(async (request) => {
      const source = await imageSource(request, facts, saveWebImages);
      if (!source) throw Object.assign(new Error('skipped'), { code: 'skipped', request });
      return { asset: await queue.add(source), alt: request.alt };
    }),
  );
  const imported: { asset: ImportedAsset; alt: string }[] = [];
  // A web image that wasn't saved becomes a link to it (section 15.5).
  const linked: ImageRequest[] = [];
  let failed = 0;
  done.forEach((result, index) => {
    if (result.status === 'fulfilled') imported.push(result.value);
    else if (requests[index].kind === 'remote') linked.push(requests[index]);
    else if ((result.reason as { code?: string }).code !== 'skipped') failed += 1;
  });
  if (failed > 0) showToast({ message: t('images.failed', { count: failed }), tone: 'danger' });
  const table = assetTable(mounted.page);
  imported.forEach(({ asset }) => table.add(asset.id, asset.asset));
  return { imported, linked };
}

/** Links to web images that weren't saved, one paragraph each, with their descriptions. */
function imageLinks(requests: readonly ImageRequest[]): PastedPiece {
  const { paragraph, doc } = textSchema.nodes;
  const link = textSchema.marks.link;
  const lines = requests.map((request) =>
    paragraph.create(null, textSchema.text(request.alt || request.src, [link.create({ href: request.src })])),
  );
  return { kind: 'text', doc: doc.create(null, Fragment.from(lines)) };
}

/** Imports a paste's images and inserts them as one step, with links to the web images that weren't saved. */
async function addImages(
  mounted: MountedPage,
  requests: readonly ImageRequest[],
  facts: ClipboardFacts | null,
  saveWebImages: boolean,
  place: Placement,
): Promise<void> {
  const { imported, linked } = await importAll(mounted, requests, facts, saveWebImages);
  const choice = pasteSizeChoice(mounted);
  const images = imageEdits(mounted, imported, place, sizingFor(choice));
  const links = linked.length > 0 ? blockEdits(mounted, [imageLinks(linked)], place) : { edits: [], blocks: [] };
  const edits = [...images.edits, ...links.edits.map((edit) => afterLast(edit, images.blocks))];
  if (edits.length === 0) return;
  const ack = await mounted.sync.send({ edits });
  showInserted(mounted, edits, ack.orderKeys);
  if (choice === 'ask') offerActualSize(mounted, images.blocks);
}

/** Runs one paste or drop on a page view. */
export async function runPaste(
  mounted: MountedPage,
  request: PasteRequest,
  clipboard: ClipboardClient | null,
): Promise<void> {
  if (mounted.page.readOnly) return;
  const convert = flagged('page.heicImport');
  const { images: files, others } = imageFiles(request.files, convert);
  const active = mounted.pool.active();
  const editor = request.intoEditor === false ? null : (active?.editor ?? null);
  // A drop goes where it lands.
  const at =
    editor && request.point
      ? editor.view.posAtCoords({ left: request.point.clientX, top: request.point.clientY })
      : null;
  if (editor && at) editor.commands.setTextSelection(at.pos);
  const blockId = active?.block ?? currentBlock(mounted);

  // Files that are not pictures, such as Word, Excel, and PDF files, become attachments.
  const attachable = request.files.filter((file) => !files.includes(file));
  let attached = false;
  if (attachable.length > 0 && mounted.host.flag('page.dropFiles') && mounted.host.flag('page.attachments')) {
    const place = request.point
      ? placementAfter(mounted, blockId, request.point)
      : placementAfter(mounted, blockId, undefined);
    await attachFiles(mounted, attachable, place);
    attached = true;
    if (files.length === 0 && !request.html && !request.text) return;
  }

  // A link dragged from a browser becomes a link, with the link's own text.
  if (request.origin === 'drop' && !request.plain && files.length === 0 && mounted.host.flag('page.dropFiles')) {
    const link = droppedLink(request.text, request.html);
    if (link) return void (await insertDroppedLink(mounted, editor, blockId, link));
  }

  // OpenNote's own blocks, from another page or this one.
  const payload = readBlockPayload(request.html);
  if (payload && !request.plain) {
    await pasteBlocks(mounted, payload, placementAfter(mounted, blockId, request.point));
    return;
  }

  // Image files (Snipping Tool, "Copy image", or a drop), with no text worth keeping.
  if (files.length > 0 && (!request.text || request.text.trim() === '')) {
    if (!flagged('page.images')) return;
    const place = request.point
      ? placementAfter(mounted, null, request.point)
      : placementAfter(mounted, blockId, undefined);
    await insertImages(mounted, fileItems(files), place, pasteSizeChoice(mounted));
    return;
  }
  if (others > 0 && !attached && !request.html && !request.text) {
    showToast({ message: t('images.onlyImages') });
    return;
  }

  // Link over selected words: a lone web address pasted over a selection links it (FEATURES.md, Paste extras).
  if (editor && !request.plain && request.text && linkOverSelection(editor, request.text)) return;

  const facts = request.origin === 'drop' ? null : (request.facts ?? (await factsFor(clipboard, request.text ?? null)));
  const result = resultFor(request, facts, editor ? 'text' : 'page');
  if (result.plainFallback) showToast({ message: t('paste.tooLarge') });
  const pieces = splitImages(result.pieces);
  if (pieces.length === 0) return;

  // The text first, into the focused editor.
  let rest = pieces;
  let inserted: { from: number; to: number } | null = null;
  if (editor && pieces[0].kind === 'text') {
    inserted = insertIntoEditor(editor, pieces[0].doc);
    rest = pieces.slice(1);
  }
  const textAndTables = rest.filter((piece): piece is PastedPiece => piece.kind !== 'image');
  const imageRequests = rest.flatMap((piece) => (piece.kind === 'image' ? [piece.request] : []));
  const place = placementAfter(mounted, editor ? blockId : null, request.point);

  if (textAndTables.length > 0) {
    const { edits, blocks } = blockEdits(mounted, textAndTables, place);
    const ack = await mounted.sync.send({ edits });
    showInserted(mounted, edits, ack.orderKeys);
    if (place.kind === 'after') place.block = blocks[blocks.length - 1];
  } else await mounted.sync.flushAll('command');
  announce(t('paste.pasted'));

  const settings = getSettings().editing.paste;
  const extras = flagged('page.pasteExtras');
  if (imageRequests.length > 0 && flagged('page.images')) {
    const imagePlace: Placement = place.kind === 'point' ? { ...place, y: place.y + textAndTables.length * 48 } : place;
    await addImages(mounted, imageRequests, facts, !extras || settings.saveWebImages, imagePlace);
  }

  if (!extras || request.plain) return;
  if (editor && inserted && result.joinedText && settings.joinPdfLines) {
    await joinPdfLines(mounted, editor, inserted, result.joinedText);
  }
  if (facts?.sourceUrl && result.source === 'web' && editor) {
    await addSourceLink(mounted, editor, facts.sourceUrl, settings.sourceLink);
  }
}

export { importError };
