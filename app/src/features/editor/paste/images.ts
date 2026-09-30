// Images in pasted content become asset requests (Phase 4 design, 15.5). The pipeline never loads or fetches an
// image. It names each one, the page imports the bytes, and `resolveImages` swaps each source for its asset.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { textSchema } from '../schema/schema';
import type { ImageKind, ImageRequest } from './types';

const { nodes, marks } = textSchema;

/** What an image source is, or null when the page cannot import it. Only Word's temporary files count as `file:`. */
export function imageKind(src: string): ImageKind | null {
  if (/^data:image\//i.test(src)) return 'data';
  if (/^blob:/i.test(src)) return 'blob';
  if (/^https?:/i.test(src)) return 'remote';
  if (/^file:.*msohtmlclip/i.test(src)) return 'clip';
  return null;
}

/** Replaces an image that cannot be imported by its description, so the words stay. */
export function dropUnknownImages(body: HTMLElement): void {
  body.querySelectorAll('img').forEach((image) => {
    if (imageKind(image.getAttribute('src') ?? '') !== null) return;
    const alt = (image.getAttribute('alt') ?? '').trim();
    if (alt === '') image.remove();
    else image.replaceWith(image.ownerDocument.createTextNode(alt));
  });
}

/** Every distinct image in a document, in order. */
export function collectImageRequests(doc: PMNode): ImageRequest[] {
  const found = new Map<string, ImageRequest>();
  doc.descendants((node) => {
    if (node.type.name !== 'image') return true;
    const src = node.attrs.src as string;
    const kind = imageKind(src);
    if (kind !== null && !found.has(src)) found.set(src, { kind, src, alt: node.attrs.alt as string });
    return false;
  });
  return [...found.values()];
}

/** What stands in for an image that could not be imported: a link to a web image, or its description. */
function fallback(node: PMNode, request: ImageRequest): PMNode[] {
  const alt = node.attrs.alt as string;
  if (request.kind === 'remote') {
    return [
      textSchema.text(alt === '' ? request.src : alt, marks.link.create({ href: request.src }).addToSet(node.marks)),
    ];
  }
  return alt === '' ? [] : [textSchema.text(alt, node.marks)];
}

function replaceImages(node: PMNode, swap: (image: PMNode) => PMNode[]): PMNode {
  if (node.isLeaf) return node;
  const children: PMNode[] = [];
  node.forEach((child) => {
    if (child.type.name === 'image') children.push(...swap(child));
    else children.push(replaceImages(child, swap));
  });
  return node.type.create(node.attrs, Fragment.from(children), node.marks);
}

/**
 * The document with each image source swapped for what `resolve` gives: an `asset:` source once the bytes are
 * imported, or null when the import failed. A web image that failed becomes a link to it, with its description.
 */
export function resolveImages(doc: PMNode, resolve: (request: ImageRequest) => string | null): PMNode {
  return replaceImages(doc, (image) => {
    const src = image.attrs.src as string;
    const kind = imageKind(src);
    if (kind === null) return fallback(image, { kind: 'data', src, alt: image.attrs.alt as string });
    const request: ImageRequest = { kind, src, alt: image.attrs.alt as string };
    const resolved = resolve(request);
    if (resolved === null) return fallback(image, request);
    return [nodes.image.create({ src: resolved, alt: request.alt }, null, image.marks)];
  });
}
