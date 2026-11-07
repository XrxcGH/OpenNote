// How much text one text block holds. The core refuses a text block over 4 MiB of Markdown (crates/core limits.rs,
// markdown_bytes). The editor keeps a refused text as unsent and sends it again with every flush, so a paste past
// the limit never saved, and each send serialized megabytes again: Ctrl+Z after a 5 MB paste hung the window
// (Beta 8 walk A1-A07-17). A paste larger than a block holds goes into several text blocks instead.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';

/** The core's limit for one text block's Markdown, in UTF-8 bytes. */
export const CORE_TEXT_BYTES = 4 * 1024 * 1024;

/**
 * The most a paste puts in one text block, measured by contentBytes. Markdown escapes can double ASCII punctuation,
 * so a quarter of the core's limit keeps every block well inside it, and a block this size still edits quickly.
 */
export const PASTE_TEXT_BUDGET = 1024 * 1024;

const encoder = new TextEncoder();

/** A node's size as UTF-8 bytes of its JSON: its text, plus link addresses and other attributes. */
export function contentBytes(node: PMNode): number {
  return encoder.encode(JSON.stringify(node.toJSON())).length;
}

/** Whether `added` can join the text a block holds now and keep the block within half the core's limit. */
export function hasRoomFor(existing: PMNode, added: PMNode): boolean {
  return contentBytes(existing) + contentBytes(added) <= CORE_TEXT_BYTES / 2;
}

/**
 * The document cut between its top-level blocks into documents of at most `budget` bytes each, in order. A document
 * inside the budget comes back as it is. A single block larger than the budget stays whole, in a document of its own.
 */
export function splitToBudget(doc: PMNode, budget = PASTE_TEXT_BUDGET): PMNode[] {
  if (contentBytes(doc) <= budget) return [doc];
  const docs: PMNode[] = [];
  let run: PMNode[] = [];
  let size = 0;
  const flush = () => {
    if (run.length > 0) docs.push(doc.type.create(doc.attrs, Fragment.from(run)));
    run = [];
    size = 0;
  };
  doc.forEach((block) => {
    const bytes = contentBytes(block);
    if (run.length > 0 && size + bytes > budget) flush();
    run.push(block);
    size += bytes;
  });
  flush();
  return docs;
}
